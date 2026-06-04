import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../repositories/practitioner-payouts.repository.js')

import * as service from '../services/practitioner-payouts.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/practitioner-payouts.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PRAC_ID   = '11111111-1111-1111-1111-111111111111'
const SVC_ID    = '22222222-2222-2222-2222-222222222222'
const BOOK_ID   = '33333333-3333-3333-3333-333333333333'
const PAY_ID    = '44444444-4444-4444-4444-444444444444'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('computeCommission (pure)', () => {
  it('rate-only', () => {
    expect(service.computeCommission({ grossCents: 10000, ratePct: 30 })).toBe(3000)
  })

  it('rate + flat fee', () => {
    expect(service.computeCommission({ grossCents: 10000, ratePct: 30, flatFeeCents: 500 })).toBe(3500)
  })

  it('rounds half-up', () => {
    expect(service.computeCommission({ grossCents: 333, ratePct: 33 })).toBe(110)  // round(109.89) = 110
  })

  it('clamps to 0', () => {
    expect(service.computeCommission({ grossCents: 0, ratePct: 30 })).toBe(0)
  })
})

describe('rules', () => {
  it('createRule scopes', async () => {
    repo.insertCommissionRule.mockResolvedValue({ id: 'r1' })
    await service.createRule(ctx, { practitionerId: PRAC_ID, ratePct: 30 })
    expect(repo.insertCommissionRule).toHaveBeenCalled()
  })

  it('listRules passes filters', async () => {
    repo.listCommissionRules.mockResolvedValue([])
    await service.listRules(ctx, { practitionerId: PRAC_ID })
    expect(repo.listCommissionRules).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { practitionerId: PRAC_ID })
  })
})

describe('closePeriod', () => {
  it('rejects when no accruals', async () => {
    repo.listAccruals.mockResolvedValue([])
    await expect(service.closePeriod(ctx, {
      practitionerId: PRAC_ID,
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd:   '2026-05-01T00:00:00Z',
    })).rejects.toThrow(ConflictError)
  })

  it('sums accruals, creates payout, attaches accruals, publishes payout.created', async () => {
    repo.listAccruals.mockResolvedValue([
      { commission_cents: 1000 }, { commission_cents: 500 }, { commission_cents: 250 },
    ])
    repo.insertPayout.mockResolvedValue({ id: PAY_ID })
    repo.attachAccrualsToPayout.mockResolvedValue(1750)
    await service.closePeriod(ctx, {
      practitionerId: PRAC_ID,
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd:   '2026-05-01T00:00:00Z',
    })
    expect(repo.insertPayout).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ totalCommissionCents: 1750, practitionerId: PRAC_ID }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payout.created',
      payload: expect.objectContaining({ payoutId: PAY_ID, totalCommissionCents: 1750 }),
    }))
  })
})

describe('markPayoutPaid / getPayout', () => {
  it('markPayoutPaid sets paid + emits payout.paid', async () => {
    repo.setPayoutStatus.mockResolvedValue({ id: PAY_ID, status: 'paid' })
    await service.markPayoutPaid(ctx, PAY_ID, 'txn-abc')
    expect(repo.setPayoutStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PAY_ID, 'paid', 'txn-abc', { expectedStatus: 'pending' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'payout.paid' }))
  })

  it('markPayoutPaid throws NotFoundError when missing', async () => {
    repo.setPayoutStatus.mockResolvedValue(null)
    await expect(service.markPayoutPaid(ctx, PAY_ID)).rejects.toThrow(NotFoundError)
  })

  it('getPayout throws NotFoundError when missing', async () => {
    repo.findPayoutById.mockResolvedValue(null)
    await expect(service.getPayout(ctx, PAY_ID)).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking lifecycle', () => {
  it('booking.completed accrues per practitioner attached, splits gross evenly with rounding remainder on the first', async () => {
    let bookingsLookupCalls = 0
    let practitionersLookupCalls = 0
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockImplementation(async (sql) => {
        if (sql.includes('platform_bookings.bookings')) {
          bookingsLookupCalls++
          return { rows: [{ id: BOOK_ID, service_id: SVC_ID, price_cents: 10003 }] }
        }
        if (sql.includes("kind='practitioner'")) {
          practitionersLookupCalls++
          return { rows: [{ practitioner_id: 'p1' }, { practitioner_id: 'p2' }] }
        }
        return { rows: [] }
      })
      return fn(c)
    })
    repo.findApplicableRule.mockResolvedValue({ rate_pct: 30, flat_fee_cents: 0 })
    repo.insertAccrual.mockResolvedValue()

    await service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })

    expect(bookingsLookupCalls).toBe(1)
    expect(practitionersLookupCalls).toBe(1)
    expect(repo.insertAccrual).toHaveBeenCalledTimes(2)

    // Gross 10003 split into 5002 (p1) + 5001 (p2). Commission = 30%.
    const calls = repo.insertAccrual.mock.calls
    const p1 = calls[0][3]
    const p2 = calls[1][3]
    expect(p1.grossCents).toBe(5002)
    expect(p2.grossCents).toBe(5001)
    expect(p1.commissionCents).toBe(1501)  // round(5002 * 0.3) = 1501
    expect(p2.commissionCents).toBe(1500)  // round(5001 * 0.3) = 1500
  })

  it('booking.completed skips when price_cents missing', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ id: BOOK_ID, service_id: SVC_ID, price_cents: null }] })
      return fn(c)
    })
    await service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.insertAccrual).not.toHaveBeenCalled()
  })

  it('booking.completed skips when no rule applies', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockImplementation(async (sql) => {
        if (sql.includes('platform_bookings.bookings')) {
          return { rows: [{ id: BOOK_ID, service_id: SVC_ID, price_cents: 1000 }] }
        }
        if (sql.includes("kind='practitioner'")) {
          return { rows: [{ practitioner_id: 'p1' }] }
        }
        return { rows: [] }
      })
      return fn(c)
    })
    repo.findApplicableRule.mockResolvedValue(null)
    await service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.insertAccrual).not.toHaveBeenCalled()
  })

  it('booking.cancelled reverses an accrued accrual', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findAccrualByBooking.mockResolvedValue({ id: 'a1', status: 'accrued' })
    repo.reverseAccrual.mockResolvedValue({ id: 'a1', status: 'reversed' })
    await service.handleEvent({
      type: 'booking.cancelled',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.reverseAccrual).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'a1')
  })

  it('booking.cancelled skips reversal if accrual is already paid/reversed', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findAccrualByBooking.mockResolvedValue({ id: 'a1', status: 'paid' })
    await service.handleEvent({
      type: 'booking.cancelled',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.reverseAccrual).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    withTenantTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })).resolves.toBeUndefined()
  })
})
