/**
 * Integration tests for platform/telehealth — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-telehealth test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createRoom, getRoom, issueToken, endRoom, cancelRoom, handleEvent,
} from '../../services/telehealth.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-th'
const TENANT_ID = '00000000-0000-0000-0000-0000000002f1'

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
  await adminPool.query(`DELETE FROM platform_telehealth.tokens   WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_telehealth.rooms    WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_services.services   WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'practitioner', ...overrides,
})

async function seedService(modality = 'telehealth') {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_services.services
       (id, app_id, tenant_id, code, name, duration_minutes, modality)
     VALUES ($1,$2,$3,$4,'svc',30,$5)`,
    [id, APP_ID, TENANT_ID, 'TH-' + uuidv4().slice(0, 6), modality],
  )
  return id
}

describe('createRoom + token lifecycle', () => {
  it('creates a room and issues host/guest tokens', async () => {
    const room = await createRoom(ctx(), {
      bookingId: uuidv4(),
      startsAt: '2026-05-01T10:00:00Z',
      endsAt:   '2026-05-01T10:30:00Z',
    })
    expect(room.app_id).toBe(APP_ID)
    expect(room.provider).toBe('stub')
    expect(room.join_url).toMatch(/^https:\/\/telehealth\.local\/rooms\//)
    // expires_at = endsAt + 30 min grace
    expect(new Date(room.expires_at).toISOString()).toBe('2026-05-01T11:00:00.000Z')

    const host  = await issueToken(ctx(), room.id, { participantRole: 'host' })
    const guest = await issueToken(ctx(), room.id, { participantRole: 'guest' })
    expect(host.participant_role).toBe('host')
    expect(guest.participant_role).toBe('guest')
    expect(host.token).not.toBe(guest.token)
  })

  it('issueToken rejects on ended room', async () => {
    const room = await createRoom(ctx(), {
      bookingId: uuidv4(),
      startsAt: '2026-05-01T10:00:00Z',
      endsAt:   '2026-05-01T10:30:00Z',
    })
    await endRoom(ctx(), room.id)
    await expect(issueToken(ctx(), room.id, { participantRole: 'host' })).rejects.toThrow(ConflictError)
  })

  it('endRoom emits telehealth.room.ended', async () => {
    const room = await createRoom(ctx(), {
      bookingId: uuidv4(),
      startsAt: '2026-05-01T10:00:00Z',
      endsAt:   '2026-05-01T10:30:00Z',
    })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))
    try {
      await endRoom(ctx(), room.id)
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'telehealth.room.ended' && e.payload.roomId === room.id)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'telehealth.room.ended')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('cancelRoom marks cancelled', async () => {
    const room = await createRoom(ctx(), {
      bookingId: uuidv4(), startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
    })
    const cancelled = await cancelRoom(ctx(), room.id)
    expect(cancelled.status).toBe('cancelled')
  })

  it('getRoom / endRoom throw NotFoundError on unknown id', async () => {
    await expect(getRoom(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
    await expect(endRoom(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking.confirmed auto-provision', () => {
  it('provisions a room when service modality is telehealth', async () => {
    const sid = await seedService('telehealth')
    const bookingId = uuidv4()
    await handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z', clientUserId: uuidv4(),
      },
    })
    const { rows } = await adminPool.query(
      `SELECT * FROM platform_telehealth.rooms WHERE app_id=$1 AND booking_id=$2`,
      [APP_ID, bookingId],
    )
    expect(rows).toHaveLength(1)
  })

  it('skips when modality is in_person', async () => {
    const sid = await seedService('in_person')
    const bookingId = uuidv4()
    await handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })
    const { rows } = await adminPool.query(
      `SELECT * FROM platform_telehealth.rooms WHERE app_id=$1 AND booking_id=$2`,
      [APP_ID, bookingId],
    )
    expect(rows).toHaveLength(0)
  })

  it('de-dupes when a room already exists for the booking', async () => {
    const sid = await seedService('hybrid')
    const bookingId = uuidv4()
    await handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })
    await handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS c FROM platform_telehealth.rooms WHERE app_id=$1 AND booking_id=$2`,
      [APP_ID, bookingId],
    )
    expect(rows[0].c).toBe(1)
  })
})
