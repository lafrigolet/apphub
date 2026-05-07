/**
 * Integration tests for platform/bookings — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-bookings test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createBooking, getBooking, listBookings, changeStatus, cancelBooking, reschedule,
  addToWaitlist, listWaitlist, notifyWaitlist,
} from '../../services/bookings.service.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'

const APP_ID    = 'int-test-bk'
const TENANT_ID = '00000000-0000-0000-0000-0000000002c1'

let adminPool, redis

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
  await adminPool.query(`DELETE FROM platform_bookings.booking_events    WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.booking_resources WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.bookings          WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.waitlist          WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'buyer', ...overrides,
})

const buildBooking = () => ({
  serviceId:    uuidv4(),
  resourceIds:  [uuidv4()],
  startsAt:     '2026-05-01T10:00:00Z',
  endsAt:       '2026-05-01T10:30:00Z',
  clientName:   'Ana',
})

describe('createBooking', () => {
  it('persists booking + resource link + initial event', async () => {
    const b = await createBooking(ctx(), buildBooking())
    expect(b.app_id).toBe(APP_ID)
    expect(b.status).toBe('requested')
    expect(b.resourceIds).toHaveLength(1)
    expect(b.events.map((e) => e.to_status)).toEqual(['requested'])
  })

  it('rejects empty resourceIds', async () => {
    const body = buildBooking()
    body.resourceIds = []
    await expect(createBooking(ctx(), body)).rejects.toThrow(ValidationError)
  })

  it('rejects when endsAt <= startsAt', async () => {
    const body = buildBooking()
    body.endsAt = body.startsAt
    await expect(createBooking(ctx(), body)).rejects.toThrow(ValidationError)
  })

  it('rejects with ConflictError when an existing non-cancelled booking overlaps the same resource window', async () => {
    const sharedResource = uuidv4()
    const first  = buildBooking()
    const second = buildBooking()
    first.resourceIds  = [sharedResource]
    second.resourceIds = [sharedResource]
    // Same window — should collide.
    second.startsAt = first.startsAt
    second.endsAt   = first.endsAt

    await createBooking(ctx(), first)
    await expect(createBooking(ctx(), second)).rejects.toThrow(ConflictError)
  })

  it('does NOT collide when one of the overlapping bookings was cancelled', async () => {
    const sharedResource = uuidv4()
    const first  = buildBooking()
    first.resourceIds  = [sharedResource]
    const a = await createBooking(ctx(), first)
    await cancelBooking(ctx(), a.id, 'free up the slot')

    const second = buildBooking()
    second.resourceIds = [sharedResource]
    second.startsAt = first.startsAt
    second.endsAt   = first.endsAt
    const b = await createBooking(ctx(), second)
    expect(b.id).not.toBe(a.id)
  })
})

describe('FSM', () => {
  it('walks requested → confirmed → checked_in → in_progress → completed', async () => {
    const b = await createBooking(ctx(), buildBooking())
    await changeStatus(ctx(), b.id, 'confirmed')
    await changeStatus(ctx(), b.id, 'checked_in')
    await changeStatus(ctx(), b.id, 'in_progress')
    const final = await changeStatus(ctx(), b.id, 'completed')
    expect(final.status).toBe('completed')

    const full = await getBooking(ctx(), b.id)
    expect(full.events.map((e) => e.to_status)).toEqual(['requested','confirmed','checked_in','in_progress','completed'])
  })

  it('rejects invalid transition requested → completed', async () => {
    const b = await createBooking(ctx(), buildBooking())
    await expect(changeStatus(ctx(), b.id, 'completed')).rejects.toThrow(ConflictError)
  })

  it('cancelBooking shorthand', async () => {
    const b = await createBooking(ctx(), buildBooking())
    const cancelled = await cancelBooking(ctx(), b.id, 'reason')
    expect(cancelled.status).toBe('cancelled')
  })
})

describe('reschedule', () => {
  it('marks original rescheduled and creates a confirmed clone', async () => {
    const b = await createBooking(ctx(), buildBooking())
    await changeStatus(ctx(), b.id, 'confirmed')
    const cloned = await reschedule(ctx(), b.id, {
      startsAt: '2026-05-02T10:00:00Z', endsAt: '2026-05-02T10:30:00Z',
    })
    expect(cloned.status).toBe('confirmed')
    const original = await getBooking(ctx(), b.id)
    expect(original.status).toBe('rescheduled')
  })

  it('rejects rescheduling a cancelled booking', async () => {
    const b = await createBooking(ctx(), buildBooking())
    await cancelBooking(ctx(), b.id, 'x')
    await expect(reschedule(ctx(), b.id, {
      startsAt: '2026-05-02T10:00:00Z', endsAt: '2026-05-02T10:30:00Z',
    })).rejects.toThrow(ConflictError)
  })
})

describe('redis events', () => {
  it('emits booking.requested then booking.confirmed', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const b = await createBooking(ctx(), buildBooking())
      await changeStatus(ctx(), b.id, 'confirmed')
      const wantTypes = ['booking.requested', 'booking.confirmed']
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !wantTypes.every((t) => events.some((e) => e.type === t && e.payload.bookingId === b.id))) {
        await new Promise((r) => setTimeout(r, 50))
      }
      for (const t of wantTypes) {
        expect(events.find((e) => e.type === t && e.payload.bookingId === b.id)).toBeTruthy()
      }
    } finally {
      sub.disconnect()
    }
  })
})

describe('list filters + waitlist', () => {
  it('listBookings filters by status', async () => {
    const a = await createBooking(ctx(), buildBooking())
    await createBooking(ctx(), buildBooking())
    await changeStatus(ctx(), a.id, 'confirmed')
    const confirmed = await listBookings(ctx(), { status: 'confirmed' })
    expect(confirmed.find((b) => b.id === a.id)).toBeTruthy()
  })

  it('waitlist add / list / notify', async () => {
    const w = await addToWaitlist(ctx(), { serviceId: uuidv4(), clientName: 'X' })
    expect(w.status).toBe('waiting')
    const waiting = await listWaitlist(ctx(), { status: 'waiting' })
    expect(waiting.find((x) => x.id === w.id)).toBeTruthy()
    const notified = await notifyWaitlist(ctx(), w.id)
    expect(notified.status).toBe('notified')
  })

  it('notifyWaitlist on unknown id throws NotFoundError', async () => {
    await expect(notifyWaitlist(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('tenant isolation', () => {
  it('bookings from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000002c2'
    await createBooking(ctx(), buildBooking())
    await createBooking(ctx({ tenantId: T2 }), buildBooking())
    const own = await listBookings(ctx(), {})
    expect(own.every((b) => b.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_bookings.booking_resources WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
    await adminPool.query(`DELETE FROM platform_bookings.bookings          WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
