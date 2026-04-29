/**
 * Integration tests for platform/packages — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-packages test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createTemplate, listTemplates, purchase, getPurchase, listPurchases,
  redeem, refundSession, handleEvent,
} from '../../services/packages.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-pk'
const TENANT_ID = '00000000-0000-0000-0000-0000000003a1'

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
  await adminPool.query(`DELETE FROM platform_packages.redemptions          WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_packages.purchased_packages   WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_packages.package_templates    WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.booking_resources    WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.bookings             WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'buyer', ...overrides,
})

async function seedBookingWithPackage(packageId, { status = 'completed', priceCents = 5000 } = {}) {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_bookings.bookings
       (id, app_id, tenant_id, service_id, client_user_id, starts_at, ends_at, status, currency, price_cents, package_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EUR',$9,$10)`,
    [id, APP_ID, TENANT_ID, uuidv4(), uuidv4(),
     '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', status, priceCents, packageId],
  )
  return id
}

describe('templates and purchase', () => {
  it('creates template, lists, and purchases', async () => {
    const t = await createTemplate(ctx(), {
      code: 'P10-' + uuidv4().slice(0, 4), name: '10x', serviceId: uuidv4(), totalSessions: 10, validityDays: 30,
    })
    const list = await listTemplates(ctx(), {})
    expect(list.find((x) => x.id === t.id)).toBeTruthy()

    const p = await purchase(ctx(), { templateId: t.id })
    expect(p.total_sessions).toBe(10)
    expect(p.remaining_sessions).toBe(10)
    expect(p.status).toBe('active')
    expect(new Date(p.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('rejects purchase on inactive template', async () => {
    const t = await createTemplate(ctx(), {
      code: 'INA-' + uuidv4().slice(0, 4), name: 'inactive', serviceId: uuidv4(), totalSessions: 5,
      isActive: false,
    })
    await expect(purchase(ctx(), { templateId: t.id })).rejects.toThrow(ConflictError)
  })
})

describe('redeem / refund', () => {
  it('decrement, exhausted, refund flow', async () => {
    const t = await createTemplate(ctx(), {
      code: 'R-' + uuidv4().slice(0, 4), name: 'X', serviceId: uuidv4(), totalSessions: 2,
    })
    const p = await purchase(ctx(), { templateId: t.id })

    const r1 = await redeem(ctx(), { packageId: p.id })
    expect(r1.remaining_sessions).toBe(1)
    expect(r1.status).toBe('active')

    const r2 = await redeem(ctx(), { packageId: p.id })
    expect(r2.remaining_sessions).toBe(0)
    expect(r2.status).toBe('exhausted')

    await expect(redeem(ctx(), { packageId: p.id })).rejects.toThrow(ConflictError)

    const refunded = await refundSession(ctx(), { packageId: p.id })
    expect(refunded.remaining_sessions).toBe(1)
    const after = await getPurchase(ctx(), p.id)
    expect(after.status).toBe('active')
  })

  it('refundSession rejects when nothing has been redeemed', async () => {
    const t = await createTemplate(ctx(), {
      code: 'NRE-' + uuidv4().slice(0, 4), name: 'X', serviceId: uuidv4(), totalSessions: 5,
    })
    const p = await purchase(ctx(), { templateId: t.id })
    await expect(refundSession(ctx(), { packageId: p.id })).rejects.toThrow(ConflictError)
  })

  it('redeem publishes package.exhausted on last session', async () => {
    const t = await createTemplate(ctx(), {
      code: 'EXH-' + uuidv4().slice(0, 4), name: 'X', serviceId: uuidv4(), totalSessions: 1,
    })
    const p = await purchase(ctx(), { templateId: t.id })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))
    try {
      await redeem(ctx(), { packageId: p.id })
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'package.exhausted')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'package.exhausted')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('listPurchases filters out exhausted/expired by default', async () => {
    const userId = uuidv4()
    const t1 = await createTemplate(ctx(), { code: 'A-' + uuidv4().slice(0, 4), name: 'A', serviceId: uuidv4(), totalSessions: 1 })
    const t2 = await createTemplate(ctx(), { code: 'B-' + uuidv4().slice(0, 4), name: 'B', serviceId: uuidv4(), totalSessions: 5 })
    const a = await purchase(ctx({ userId }), { templateId: t1.id, clientUserId: userId })
    await purchase(ctx({ userId }), { templateId: t2.id, clientUserId: userId })
    await redeem(ctx(), { packageId: a.id })

    const active = await listPurchases(ctx(), userId, { onlyActive: true })
    expect(active.find((x) => x.id === a.id)).toBeFalsy()
  })
})

describe('handleEvent — booking lifecycle', () => {
  it('booking.completed redeems linked package', async () => {
    const t = await createTemplate(ctx(), {
      code: 'BC-' + uuidv4().slice(0, 4), name: 'X', serviceId: uuidv4(), totalSessions: 5,
    })
    const p = await purchase(ctx(), { templateId: t.id })
    const bookingId = await seedBookingWithPackage(p.id, { status: 'completed' })

    await handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId },
    })

    const after = await getPurchase(ctx(), p.id)
    expect(after.remaining_sessions).toBe(4)
    expect(after.redemptions).toHaveLength(1)
  })

  it('booking.cancelled refunds linked package', async () => {
    const t = await createTemplate(ctx(), {
      code: 'BX-' + uuidv4().slice(0, 4), name: 'X', serviceId: uuidv4(), totalSessions: 5,
    })
    const p = await purchase(ctx(), { templateId: t.id })

    // First simulate a completion to consume one session.
    const bookingA = await seedBookingWithPackage(p.id)
    await handleEvent({ type: 'booking.completed', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: bookingA } })

    // Then cancel a different booking against the same package.
    const bookingB = await seedBookingWithPackage(p.id, { status: 'cancelled' })
    await handleEvent({ type: 'booking.cancelled', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: bookingB } })

    const after = await getPurchase(ctx(), p.id)
    expect(after.remaining_sessions).toBe(5)
  })

  it('skips when booking has no package_id', async () => {
    const bookingId = uuidv4()
    await adminPool.query(
      `INSERT INTO platform_bookings.bookings
         (id, app_id, tenant_id, service_id, client_user_id, starts_at, ends_at, status, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed','EUR')`,
      [bookingId, APP_ID, TENANT_ID, uuidv4(), uuidv4(),
       '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z'],
    )
    await expect(handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId },
    })).resolves.toBeUndefined()
  })
})
