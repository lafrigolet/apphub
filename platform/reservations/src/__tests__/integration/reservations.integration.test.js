/**
 * Integration tests for platform/reservations — require a running Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-reservations test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createReservation, listReservations, getReservation, changeStatus,
  addToWaitlist, listWaitlist, notifyWaitlist,
  createServiceHours, listServiceHours,
} from '../../services/reservations.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-res'
const TENANT_ID = '00000000-0000-0000-0000-0000000000c1'

let adminPool
let redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_reservations.reservations  WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_reservations.waitlist      WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_reservations.service_hours WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'host', ...overrides,
})

describe('reservations CRUD', () => {
  it('creates and reads back', async () => {
    const r = await createReservation(ctx(), {
      guestName: 'Ana', guestEmail: 'ana@x.com', partySize: 4,
      reservedFor: '2026-05-01T20:00:00Z',
    })
    expect(r.app_id).toBe(APP_ID)
    expect(r.status).toBe('requested')

    const fetched = await getReservation(ctx(), r.id)
    expect(fetched.id).toBe(r.id)
  })

  it('getReservation throws NotFoundError on unknown id', async () => {
    await expect(getReservation(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('listReservations filters by status and time window', async () => {
    await createReservation(ctx(), { guestName: 'A', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
    await createReservation(ctx(), { guestName: 'B', partySize: 2, reservedFor: '2026-05-02T19:00:00Z' })

    const all = await listReservations(ctx(), {})
    expect(all.length).toBe(2)

    const may1 = await listReservations(ctx(), { from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z' })
    expect(may1.length).toBe(1)
    expect(may1[0].guest_name).toBe('A')
  })
})

describe('reservation status FSM', () => {
  it('walks requested → confirmed → seated → completed', async () => {
    const r = await createReservation(ctx(), { guestName: 'A', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
    const tableId = uuidv4()
    await changeStatus(ctx(), r.id, 'confirmed')
    await changeStatus(ctx(), r.id, 'seated', tableId)
    const final = await changeStatus(ctx(), r.id, 'completed')
    expect(final.status).toBe('completed')
    expect(final.table_id).toBe(tableId)
  })

  it('rejects invalid transition (requested → seated)', async () => {
    const r = await createReservation(ctx(), { guestName: 'A', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
    await expect(changeStatus(ctx(), r.id, 'seated')).rejects.toThrow(ConflictError)
  })

  it('rejects from terminal status (cancelled → confirmed)', async () => {
    const r = await createReservation(ctx(), { guestName: 'A', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
    await changeStatus(ctx(), r.id, 'cancelled')
    await expect(changeStatus(ctx(), r.id, 'confirmed')).rejects.toThrow(ConflictError)
  })
})

describe('waitlist', () => {
  it('adds, lists, and notifies', async () => {
    const w = await addToWaitlist(ctx(), { guestName: 'X', partySize: 3, guestPhone: '+34111' })
    expect(w.status).toBe('waiting')

    const waiting = await listWaitlist(ctx(), { status: 'waiting' })
    expect(waiting.find((x) => x.id === w.id)).toBeTruthy()

    const notified = await notifyWaitlist(ctx(), w.id)
    expect(notified.status).toBe('notified')
  })

  it('notifyWaitlist throws NotFoundError on unknown id', async () => {
    await expect(notifyWaitlist(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('service hours', () => {
  it('creates and lists service hours', async () => {
    await createServiceHours(ctx(), { dayOfWeek: 1, openMinute: 480, closeMinute: 1320, serviceLabel: 'L-V' })
    await createServiceHours(ctx(), { dayOfWeek: 6, openMinute: 720, closeMinute: 1440, serviceLabel: 'sábado' })
    const hours = await listServiceHours(ctx())
    expect(hours.length).toBe(2)
    expect(hours[0].day_of_week).toBe(1)
  })
})

describe('redis events', () => {
  it('emits reservation.created when a reservation is created', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const r = await createReservation(ctx(), { guestName: 'Evt', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'reservation.created' && e.payload.reservationId === r.id)) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      const evt = events.find((e) => e.type === 'reservation.created' && e.payload.reservationId === r.id)
      expect(evt).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('emits reservation.confirmed on status change', async () => {
    const r = await createReservation(ctx(), { guestName: 'Evt2', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((rs) => setTimeout(rs, 50))

    try {
      await changeStatus(ctx(), r.id, 'confirmed')
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'reservation.confirmed')) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      expect(events.find((e) => e.type === 'reservation.confirmed' && e.payload.reservationId === r.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

describe('tenant isolation', () => {
  it('reservations from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000000c2'
    await createReservation(ctx(), { guestName: 'mine', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
    await createReservation(ctx({ tenantId: T2 }), { guestName: 'other', partySize: 2, reservedFor: '2026-05-01T19:00:00Z' })
    const list = await listReservations(ctx(), {})
    expect(list.every((r) => r.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_reservations.reservations WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})
