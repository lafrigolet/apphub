// New backlog features (docs/use-cases/practitioner-payouts.md §"Recomendaciones"):
//   #2/#3 IRPF withholding at closePeriod (gross/withholding/net)
//   #5 clawback: reversing an already-paid accrual → negative adjustment
//   #6 markPayoutPaid only from 'pending'
//   #4 schedules CRUD + #3 withholding settings service delegation
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/practitioner-payouts.repository.js')

import * as service from '../services/practitioner-payouts.service.js'
import { applyWithholding } from '../services/practitioner-payouts.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/practitioner-payouts.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'clinic'
const TEN = '00000000-0000-0000-0000-000000000009'
const PRAC = 'prac-1'
const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient() { return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() } }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── applyWithholding (pure) ──────────────────────────────────────────────
describe('applyWithholding', () => {
  it('0% → no withholding, net = gross', () => {
    expect(applyWithholding(10000, 0)).toEqual({ withholdingCents: 0, netCents: 10000 })
  })
  it('15% IRPF general autónomos → round to cent', () => {
    expect(applyWithholding(10000, 15)).toEqual({ withholdingCents: 1500, netCents: 8500 })
  })
  it('7% primer año, rounding', () => {
    expect(applyWithholding(333, 7)).toEqual({ withholdingCents: 23, netCents: 310 })
  })
  it('negative gross → no withholding, net stays negative', () => {
    expect(applyWithholding(-500, 15)).toEqual({ withholdingCents: 0, netCents: -500 })
  })
})

// ── closePeriod with withholding ─────────────────────────────────────────
describe('closePeriod applies IRPF withholding', () => {
  it('resolves pct and stores gross/withholding/net on payout', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 10000 }])
    repo.resolveWithholdingPct.mockResolvedValue(15)
    repo.insertPayout.mockResolvedValue({ id: 'po-1' })
    await service.closePeriod(ctx, { practitionerId: PRAC, periodStart: 's', periodEnd: 'e' })
    expect(repo.resolveWithholdingPct).toHaveBeenCalledWith(expect.anything(), APP, TEN, PRAC)
    expect(repo.insertPayout).toHaveBeenCalledWith(expect.anything(), APP, TEN, expect.objectContaining({
      totalCommissionCents: 10000,
      grossCommissionCents: 10000,
      withholdingPct: 15,
      withholdingCents: 1500,
      netCommissionCents: 8500,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payout.created',
      payload: expect.objectContaining({ withholdingCents: 1500, netCommissionCents: 8500 }),
    }))
  })

  it('no withholding configured (0) → net == gross', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 2000 }])
    repo.resolveWithholdingPct.mockResolvedValue(0)
    repo.insertPayout.mockResolvedValue({ id: 'po-2' })
    await service.closePeriod(ctx, { practitionerId: PRAC, periodStart: 's', periodEnd: 'e' })
    expect(repo.insertPayout).toHaveBeenCalledWith(expect.anything(), APP, TEN, expect.objectContaining({
      withholdingCents: 0, netCommissionCents: 2000,
    }))
  })
})

// ── markPayoutPaid guard ─────────────────────────────────────────────────
describe('markPayoutPaid pending guard', () => {
  it('NotFoundError when payout does not exist', async () => {
    repo.setPayoutStatus.mockResolvedValue(null)
    repo.findPayoutById.mockResolvedValue(null)
    await expect(service.markPayoutPaid(ctx, 'ghost', 'ref')).rejects.toThrow(NotFoundError)
  })

  it('ConflictError when payout exists but is not pending (already cancelled)', async () => {
    repo.setPayoutStatus.mockResolvedValue(null)
    repo.findPayoutById.mockResolvedValue({ id: 'po', status: 'cancelled' })
    await expect(service.markPayoutPaid(ctx, 'po', 'ref')).rejects.toThrow(ConflictError)
    expect(publish).not.toHaveBeenCalled()
  })

  it('passes expectedStatus pending to repo on happy path', async () => {
    repo.setPayoutStatus.mockResolvedValue({ id: 'po', status: 'paid' })
    await service.markPayoutPaid(ctx, 'po', 'ref')
    expect(repo.setPayoutStatus).toHaveBeenCalledWith(expect.anything(), APP, TEN, 'po', 'paid', 'ref', { expectedStatus: 'pending' })
  })
})

// ── clawback on booking.cancelled when accrual already paid ──────────────
describe('handleEvent clawback', () => {
  it('accrued accrual → reverse + publish accrual.reversed mode=reversed', async () => {
    repo.findAccrualByBooking.mockResolvedValue({ id: 'a1', status: 'accrued', practitioner_id: PRAC })
    await service.handleEvent({
      type: 'booking.cancelled',
      payload: { appId: APP, tenantId: TEN, bookingId: 'bk-1' },
    })
    expect(repo.reverseAccrual).toHaveBeenCalledWith(expect.anything(), APP, TEN, 'a1')
    expect(repo.insertAccrual).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'accrual.reversed', payload: expect.objectContaining({ mode: 'reversed' }),
    }))
  })

  it('paid accrual → negative adjustment clawback + publish mode=clawback', async () => {
    repo.findAccrualByBooking.mockResolvedValue({
      id: 'a2', status: 'paid', practitioner_id: PRAC, service_id: 'svc',
      gross_cents: 10000, commission_cents: 3000, payout_id: 'po-old',
    })
    repo.insertAccrual.mockResolvedValue({ id: 'claw-1' })
    await service.handleEvent({
      type: 'booking.no_show',
      payload: { appId: APP, tenantId: TEN, bookingId: 'bk-2' },
    })
    expect(repo.reverseAccrual).not.toHaveBeenCalled()
    expect(repo.insertAccrual).toHaveBeenCalledWith(expect.anything(), APP, TEN, expect.objectContaining({
      practitionerId: PRAC, bookingId: 'bk-2',
      grossCents: -10000, commissionCents: -3000, type: 'adjustment',
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'accrual.reversed',
      payload: expect.objectContaining({ mode: 'clawback', clawbackAccrualId: 'claw-1' }),
    }))
  })

  it('no accrual for booking → no-op', async () => {
    repo.findAccrualByBooking.mockResolvedValue(null)
    await service.handleEvent({
      type: 'booking.cancelled',
      payload: { appId: APP, tenantId: TEN, bookingId: 'bk-3' },
    })
    expect(repo.reverseAccrual).not.toHaveBeenCalled()
    expect(repo.insertAccrual).not.toHaveBeenCalled()
  })

  it('reversed accrual (already reversed) → no-op', async () => {
    repo.findAccrualByBooking.mockResolvedValue({ id: 'a4', status: 'reversed', practitioner_id: PRAC })
    await service.handleEvent({
      type: 'booking.cancelled',
      payload: { appId: APP, tenantId: TEN, bookingId: 'bk-4' },
    })
    expect(repo.reverseAccrual).not.toHaveBeenCalled()
    expect(repo.insertAccrual).not.toHaveBeenCalled()
  })
})

// ── withholding settings service ─────────────────────────────────────────
describe('withholding settings service', () => {
  it('listWithholdingSettings delegates', async () => {
    repo.listWithholdingSettings.mockResolvedValue([{ id: 'w1' }])
    expect(await service.listWithholdingSettings(ctx)).toEqual([{ id: 'w1' }])
  })
  it('upsertWithholdingSetting delegates', async () => {
    repo.upsertWithholdingSetting.mockResolvedValue({ id: 'w1', withholding_pct: 15 })
    const r = await service.upsertWithholdingSetting(ctx, { practitionerId: null, withholdingPct: 15 })
    expect(r).toEqual({ id: 'w1', withholding_pct: 15 })
    expect(repo.upsertWithholdingSetting).toHaveBeenCalledWith(expect.anything(), APP, TEN, { practitionerId: null, withholdingPct: 15 })
  })
})

// ── schedules CRUD service ───────────────────────────────────────────────
describe('schedules CRUD service', () => {
  it('createSchedule delegates', async () => {
    repo.insertSchedule.mockResolvedValue({ id: 'sch-1' })
    expect(await service.createSchedule(ctx, { practitionerId: PRAC, period: 'monthly', nextRunAt: 'x' })).toEqual({ id: 'sch-1' })
  })
  it('listSchedules delegates with filters', async () => {
    repo.listSchedules.mockResolvedValue([])
    await service.listSchedules(ctx, { practitionerId: PRAC, isActive: true })
    expect(repo.listSchedules).toHaveBeenCalledWith(expect.anything(), APP, TEN, { practitionerId: PRAC, isActive: true })
  })
  it('getSchedule NotFound', async () => {
    repo.findScheduleById.mockResolvedValue(null)
    await expect(service.getSchedule(ctx, 'sch-x')).rejects.toThrow(NotFoundError)
  })
  it('getSchedule found', async () => {
    repo.findScheduleById.mockResolvedValue({ id: 'sch-1' })
    expect(await service.getSchedule(ctx, 'sch-1')).toEqual({ id: 'sch-1' })
  })
  it('updateSchedule NotFound when missing', async () => {
    repo.findScheduleById.mockResolvedValue(null)
    await expect(service.updateSchedule(ctx, 'sch-x', { isActive: false })).rejects.toThrow(NotFoundError)
    expect(repo.updateSchedule).not.toHaveBeenCalled()
  })
  it('updateSchedule pauses an existing schedule', async () => {
    repo.findScheduleById.mockResolvedValue({ id: 'sch-1', is_active: true })
    repo.updateSchedule.mockResolvedValue({ id: 'sch-1', is_active: false })
    const r = await service.updateSchedule(ctx, 'sch-1', { isActive: false })
    expect(r.is_active).toBe(false)
    expect(repo.updateSchedule).toHaveBeenCalledWith(expect.anything(), APP, TEN, 'sch-1', { isActive: false })
  })
  it('deleteSchedule NotFound', async () => {
    repo.deleteSchedule.mockResolvedValue(null)
    await expect(service.deleteSchedule(ctx, 'sch-x')).rejects.toThrow(NotFoundError)
  })
  it('deleteSchedule returns id', async () => {
    repo.deleteSchedule.mockResolvedValue({ id: 'sch-1' })
    expect(await service.deleteSchedule(ctx, 'sch-1')).toEqual({ id: 'sch-1' })
  })
})
