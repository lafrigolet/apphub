/**
 * Integration tests for platform/availability — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-availability test:integration
 *
 * Note: this module reads cross-schema from platform_services and
 * platform_resources, so we seed those via the superuser pool (RLS bypassed).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import { listSlots, holdSlot, releaseHold } from '../../services/availability.service.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'

const APP_ID    = 'int-test-av'
const TENANT_ID = '00000000-0000-0000-0000-0000000002d1'

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
  await adminPool.query(`DELETE FROM platform_availability.holds          WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.booking_resources  WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.bookings           WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.exceptions        WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.work_hours        WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.resource_services WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.resources         WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_services.services           WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'buyer', ...overrides,
})

// Seed helpers — write directly via the superuser pool (no RLS).
async function seedService({ durationMinutes = 30, bufferBefore = 0, bufferAfter = 0 } = {}) {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_services.services
       (id, app_id, tenant_id, code, name, duration_minutes,
        buffer_before_minutes, buffer_after_minutes, modality)
     VALUES ($1,$2,$3,$4,'svc',$5,$6,$7,'in_person')`,
    [id, APP_ID, TENANT_ID, 'C-' + uuidv4().slice(0, 6),
     durationMinutes, bufferBefore, bufferAfter],
  )
  return id
}

async function seedResource({ serviceId, dayOfWeek, startMinute, endMinute }) {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_resources.resources (id, app_id, tenant_id, kind, display_name)
     VALUES ($1,$2,$3,'practitioner','Dr. X')`,
    [id, APP_ID, TENANT_ID],
  )
  await adminPool.query(
    `INSERT INTO platform_resources.resource_services (app_id, tenant_id, resource_id, service_id)
     VALUES ($1,$2,$3,$4)`,
    [APP_ID, TENANT_ID, id, serviceId],
  )
  await adminPool.query(
    `INSERT INTO platform_resources.work_hours
       (app_id, tenant_id, resource_id, day_of_week, start_minute, end_minute)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [APP_ID, TENANT_ID, id, dayOfWeek, startMinute, endMinute],
  )
  return id
}

async function seedBooking({ resourceId, serviceId, startsAt, endsAt, status = 'confirmed' }) {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_bookings.bookings
       (id, app_id, tenant_id, service_id, client_user_id, starts_at, ends_at, status, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EUR')`,
    [id, APP_ID, TENANT_ID, serviceId, uuidv4(), startsAt, endsAt, status],
  )
  await adminPool.query(
    `INSERT INTO platform_bookings.booking_resources (app_id, tenant_id, booking_id, resource_id)
     VALUES ($1,$2,$3,$4)`,
    [APP_ID, TENANT_ID, id, resourceId],
  )
  return id
}

describe('listSlots', () => {
  it('rejects missing/invalid range', async () => {
    await expect(listSlots(ctx(), { serviceId: uuidv4() })).rejects.toThrow(ValidationError)
    await expect(listSlots(ctx(), {
      serviceId: uuidv4(), from: '2026-05-02T00:00:00Z', to: '2026-05-01T00:00:00Z',
    })).rejects.toThrow(ValidationError)
  })

  it('throws NotFoundError when service missing', async () => {
    await expect(listSlots(ctx(), {
      serviceId: uuidv4(), from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })).rejects.toThrow(NotFoundError)
  })

  it('returns []  when no resources offer the service', async () => {
    const sid = await seedService()
    const slots = await listSlots(ctx(), {
      serviceId: sid, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots).toEqual([])
  })

  it('returns 15-min step slots inside the work window', async () => {
    const sid = await seedService({ durationMinutes: 30 })
    // Friday 2026-05-01 — dow 5 in UTC. Window 09:00–11:00.
    await seedResource({ serviceId: sid, dayOfWeek: 5, startMinute: 540, endMinute: 660 })
    const slots = await listSlots(ctx(), {
      serviceId: sid, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots.length).toBe(7)
    expect(slots[0].startsAt).toBe('2026-05-01T09:00:00.000Z')
    expect(slots[slots.length - 1].startsAt).toBe('2026-05-01T10:30:00.000Z')
  })

  it('skips slots that overlap an existing booking', async () => {
    const sid = await seedService({ durationMinutes: 30 })
    const rid = await seedResource({ serviceId: sid, dayOfWeek: 5, startMinute: 540, endMinute: 660 })
    await seedBooking({
      resourceId: rid, serviceId: sid,
      startsAt: '2026-05-01T09:30:00Z', endsAt: '2026-05-01T10:00:00Z',
    })
    const slots = await listSlots(ctx(), {
      serviceId: sid, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    const starts = slots.map((s) => s.startsAt)
    expect(starts).toContain('2026-05-01T09:00:00.000Z')
    expect(starts).not.toContain('2026-05-01T09:15:00.000Z')
    expect(starts).not.toContain('2026-05-01T09:30:00.000Z')
    expect(starts).toContain('2026-05-01T10:00:00.000Z')
  })

  it('cancelled bookings do NOT block slots', async () => {
    const sid = await seedService({ durationMinutes: 30 })
    const rid = await seedResource({ serviceId: sid, dayOfWeek: 5, startMinute: 540, endMinute: 660 })
    await seedBooking({
      resourceId: rid, serviceId: sid,
      startsAt: '2026-05-01T09:30:00Z', endsAt: '2026-05-01T10:00:00Z',
      status: 'cancelled',
    })
    const slots = await listSlots(ctx(), {
      serviceId: sid, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots.length).toBe(7)
  })
})

describe('holdSlot atomicity', () => {
  it('first hold succeeds; concurrent overlapping hold fails with ConflictError', async () => {
    const sid = await seedService({ durationMinutes: 30 })
    const rid = await seedResource({ serviceId: sid, dayOfWeek: 5, startMinute: 540, endMinute: 660 })
    const slot = { startsAt: '2026-05-01T09:00:00.000Z', endsAt: '2026-05-01T09:30:00.000Z' }

    const first = await holdSlot(ctx(), { serviceId: sid, resourceId: rid, ...slot })
    expect(first.id).toBeTruthy()

    await expect(holdSlot(ctx(), { serviceId: sid, resourceId: rid, ...slot })).rejects.toThrow(ConflictError)

    // After releasing, the slot can be held again.
    await releaseHold(ctx(), first.id)
    const again = await holdSlot(ctx(), { serviceId: sid, resourceId: rid, ...slot })
    expect(again.id).toBeTruthy()
  })

  it('hold fails if a confirmed booking exists on the same window', async () => {
    const sid = await seedService({ durationMinutes: 30 })
    const rid = await seedResource({ serviceId: sid, dayOfWeek: 5, startMinute: 540, endMinute: 660 })
    await seedBooking({
      resourceId: rid, serviceId: sid,
      startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T09:30:00Z',
    })
    await expect(holdSlot(ctx(), {
      serviceId: sid, resourceId: rid,
      startsAt: '2026-05-01T09:00:00.000Z', endsAt: '2026-05-01T09:30:00.000Z',
    })).rejects.toThrow(ConflictError)
  })

  it('expired holds are purged on next holdSlot call', async () => {
    const sid = await seedService({ durationMinutes: 30 })
    const rid = await seedResource({ serviceId: sid, dayOfWeek: 5, startMinute: 540, endMinute: 660 })
    // Manually insert an expired hold.
    await adminPool.query(
      `INSERT INTO platform_availability.holds
         (app_id, tenant_id, service_id, resource_id, starts_at, ends_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() - interval '1 minute')`,
      [APP_ID, TENANT_ID, sid, rid,
       '2026-05-01T09:00:00Z', '2026-05-01T09:30:00Z'],
    )
    // New hold for the same slot should succeed because the expired hold is purged first.
    const r = await holdSlot(ctx(), {
      serviceId: sid, resourceId: rid,
      startsAt: '2026-05-01T09:00:00.000Z', endsAt: '2026-05-01T09:30:00.000Z',
    })
    expect(r.id).toBeTruthy()
  })
})

describe('releaseHold', () => {
  it('throws NotFoundError on unknown id', async () => {
    await expect(releaseHold(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})
