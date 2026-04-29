/**
 * Integration tests for platform/practitioner-payouts — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-practitioner-payouts test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createRule, listRules, createAccrual, listAccruals,
  closePeriod, markPayoutPaid, getPayout, listPayouts,
  handleEvent, computeCommission,
} from '../../services/practitioner-payouts.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-pp'
const TENANT_ID = '00000000-0000-0000-0000-0000000003b1'

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
  await adminPool.query(`DELETE FROM platform_practitioner_payouts.accruals          WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_practitioner_payouts.payouts           WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_practitioner_payouts.commission_rules  WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.booking_resources             WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_bookings.bookings                      WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.resources                    WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'admin', ...overrides,
})

async function seedPractitioner() {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_resources.resources (id, app_id, tenant_id, kind, display_name)
     VALUES ($1,$2,$3,'practitioner','Dr. X')`,
    [id, APP_ID, TENANT_ID],
  )
  return id
}

async function seedBookingForPractitioners(practitionerIds, { priceCents, status = 'completed' }) {
  const id = uuidv4()
  const serviceId = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_bookings.bookings
       (id, app_id, tenant_id, service_id, client_user_id, starts_at, ends_at, status, currency, price_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EUR',$9)`,
    [id, APP_ID, TENANT_ID, serviceId, uuidv4(),
     '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', status, priceCents],
  )
  for (const pid of practitionerIds) {
    await adminPool.query(
      `INSERT INTO platform_bookings.booking_resources (app_id, tenant_id, booking_id, resource_id)
       VALUES ($1,$2,$3,$4)`,
      [APP_ID, TENANT_ID, id, pid],
    )
  }
  return { id, serviceId }
}

describe('rules', () => {
  it('creates and lists rules', async () => {
    const pid = uuidv4()
    await createRule(ctx(), { practitionerId: pid, ratePct: 30 })
    await createRule(ctx(), { practitionerId: pid, serviceId: uuidv4(), ratePct: 40 })
    const list = await listRules(ctx(), { practitionerId: pid })
    expect(list).toHaveLength(2)
  })
})

describe('accruals + closePeriod', () => {
  it('manual accruals close into a payout', async () => {
    const pid = uuidv4()
    await createAccrual(ctx(), { practitionerId: pid, grossCents: 10000, commissionCents: 3000, occurredAt: '2026-04-15T00:00:00Z' })
    await createAccrual(ctx(), { practitionerId: pid, grossCents:  5000, commissionCents: 1500, occurredAt: '2026-04-20T00:00:00Z' })

    const payout = await closePeriod(ctx(), {
      practitionerId: pid,
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd:   '2026-05-01T00:00:00Z',
    })
    expect(Number(payout.total_commission_cents)).toBe(4500)

    // Accruals are now marked paid + linked to the payout.
    const stillAccrued = await listAccruals(ctx(), { practitionerId: pid, status: 'accrued' })
    expect(stillAccrued).toHaveLength(0)
  })

  it('rejects close when no accruals in period', async () => {
    await expect(closePeriod(ctx(), {
      practitionerId: uuidv4(),
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd:   '2026-05-01T00:00:00Z',
    })).rejects.toThrow(ConflictError)
  })
})

describe('markPayoutPaid', () => {
  it('flips to paid and emits payout.paid', async () => {
    const pid = uuidv4()
    await createAccrual(ctx(), { practitionerId: pid, grossCents: 1000, commissionCents: 300, occurredAt: '2026-04-15T00:00:00Z' })
    const payout = await closePeriod(ctx(), {
      practitionerId: pid,
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd:   '2026-05-01T00:00:00Z',
    })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))
    try {
      const updated = await markPayoutPaid(ctx(), payout.id, 'sepa-123')
      expect(updated.status).toBe('paid')
      expect(updated.paid_at).toBeTruthy()
      expect(updated.external_ref).toBe('sepa-123')

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'payout.paid')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'payout.paid')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('throws NotFoundError on unknown id', async () => {
    await expect(markPayoutPaid(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
    await expect(getPayout(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking lifecycle', () => {
  it('booking.completed accrues commission for each practitioner attached', async () => {
    const p1 = await seedPractitioner()
    const p2 = await seedPractitioner()
    await createRule(ctx(), { practitionerId: p1, ratePct: 30 })
    await createRule(ctx(), { practitionerId: p2, ratePct: 40 })
    const { id: bookingId } = await seedBookingForPractitioners([p1, p2], { priceCents: 10003 })

    await handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId },
    })

    const accruals = await listAccruals(ctx(), {})
    expect(accruals).toHaveLength(2)

    // Gross 10003 split: 5002 (first) + 5001 (second). Commission 30% / 40%.
    const a1 = accruals.find((a) => a.practitioner_id === p1)
    const a2 = accruals.find((a) => a.practitioner_id === p2)
    expect(Number(a1.gross_cents) + Number(a2.gross_cents)).toBe(10003)
    // Both rates applied independently.
    expect(Number(a1.commission_cents)).toBe(computeCommission({ grossCents: a1.gross_cents, ratePct: 30 }))
    expect(Number(a2.commission_cents)).toBe(computeCommission({ grossCents: a2.gross_cents, ratePct: 40 }))
  })

  it('skips practitioners without a rule', async () => {
    const p = await seedPractitioner()
    const { id: bookingId } = await seedBookingForPractitioners([p], { priceCents: 5000 })
    await handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId },
    })
    const accruals = await listAccruals(ctx(), {})
    expect(accruals).toHaveLength(0)
  })

  it('booking.cancelled reverses an accrued accrual for that booking', async () => {
    const p = await seedPractitioner()
    await createRule(ctx(), { practitionerId: p, ratePct: 30 })
    const { id: bookingId } = await seedBookingForPractitioners([p], { priceCents: 5000 })

    await handleEvent({ type: 'booking.completed', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId } })
    let accruals = await listAccruals(ctx(), {})
    expect(accruals[0].status).toBe('accrued')

    await handleEvent({ type: 'booking.cancelled', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId } })
    accruals = await listAccruals(ctx(), {})
    expect(accruals[0].status).toBe('reversed')
  })
})

describe('listPayouts', () => {
  it('filters by practitioner', async () => {
    const p1 = uuidv4()
    const p2 = uuidv4()
    await createAccrual(ctx(), { practitionerId: p1, grossCents: 1000, commissionCents: 300, occurredAt: '2026-04-15T00:00:00Z' })
    await createAccrual(ctx(), { practitionerId: p2, grossCents: 2000, commissionCents: 600, occurredAt: '2026-04-15T00:00:00Z' })
    await closePeriod(ctx(), { practitionerId: p1, periodStart: '2026-04-01T00:00:00Z', periodEnd: '2026-05-01T00:00:00Z' })
    await closePeriod(ctx(), { practitionerId: p2, periodStart: '2026-04-01T00:00:00Z', periodEnd: '2026-05-01T00:00:00Z' })
    const onlyP1 = await listPayouts(ctx(), { practitionerId: p1 })
    expect(onlyP1.every((p) => p.practitioner_id === p1)).toBe(true)
  })
})
