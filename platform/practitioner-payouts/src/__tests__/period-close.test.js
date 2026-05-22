// Cierre de periodo (closePeriod) + scheduler handler.
// Contrato:
//   - Agrupa accruals con status='accrued' del practitioner en [periodStart, periodEnd).
//   - Suma commission_cents → totalCommissionCents.
//   - INSERT payout + attach accruals al payout (transición a status='attached').
//   - Publica payout.created.
//   - 'no accruals in period' → ConflictError (operación no-op, no se crea payout vacío).
//
// Scheduler handler (handleScheduledPayout):
//   - Solo procesa events tipo 'payout.period_due'.
//   - Requiere appId+tenantId+practitionerId+periodStart+periodEnd; else ignora.
//   - CONFLICT (no accruals) loguea info pero NO propaga.
//   - Idempotencia: si el scheduler reintenta, el segundo close lanza
//     'no accruals' (porque ya están attached).

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
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/practitioner-payouts.repository.js')

import { closePeriod, markPayoutPaid, handleScheduledPayout } from '../services/practitioner-payouts.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/practitioner-payouts.repository.js'

const ctx = { appId: 'yoga', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'admin-1', role: 'admin' }
const PRAC = 'practitioner-1'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── closePeriod ──────────────────────────────────────────────────────

describe('closePeriod', () => {
  it('happy path: 3 accruals → 1 payout con total = suma de commissions', async () => {
    repo.listAccruals.mockResolvedValue([
      { id: 'a1', commission_cents: 1000 },
      { id: 'a2', commission_cents: 2500 },
      { id: 'a3', commission_cents: 500 },
    ])
    repo.insertPayout.mockResolvedValue({ id: 'po-1', total_commission_cents: 4000 })

    const r = await closePeriod(ctx, {
      practitionerId: PRAC,
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd:   '2026-05-01T00:00:00Z',
    })

    expect(repo.insertPayout).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId,
      expect.objectContaining({
        practitionerId: PRAC,
        totalCommissionCents: 4000,
        currency: 'EUR',
      }),
    )
    expect(repo.attachAccrualsToPayout).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'po-1', PRAC,
      '2026-04-01T00:00:00Z', '2026-05-01T00:00:00Z',
    )
    expect(r.id).toBe('po-1')
  })

  it('publica payout.created con el total', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 1500 }])
    repo.insertPayout.mockResolvedValue({ id: 'po-1' })
    await closePeriod(ctx, { practitionerId: PRAC, periodStart: 'x', periodEnd: 'y' })
    expect(publish).toHaveBeenCalledWith({
      type: 'payout.created',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        payoutId: 'po-1', practitionerId: PRAC, totalCommissionCents: 1500,
      },
    })
  })

  it('sin accruals → ConflictError "no accruals in period" (no payout vacío)', async () => {
    repo.listAccruals.mockResolvedValue([])
    await expect(
      closePeriod(ctx, { practitionerId: PRAC, periodStart: 'x', periodEnd: 'y' }),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('no accruals') })
    expect(repo.insertPayout).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('filtra solo accruals con status="accrued" (no incluye attached/paid)', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 1000 }])
    repo.insertPayout.mockResolvedValue({ id: 'po-1' })
    await closePeriod(ctx, { practitionerId: PRAC, periodStart: 'x', periodEnd: 'y' })
    expect(repo.listAccruals).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId,
      expect.objectContaining({ status: 'accrued' }),
    )
  })

  it('currency default EUR; respeta el override', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 100 }])
    repo.insertPayout.mockResolvedValue({ id: 'po-1' })
    await closePeriod(ctx, { practitionerId: PRAC, periodStart: 'x', periodEnd: 'y', currency: 'USD' })
    expect(repo.insertPayout).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.any(String),
      expect.objectContaining({ currency: 'USD' }),
    )
  })

  it('IDEMPOTENCIA: 2º close del MISMO periodo encuentra 0 accruals (ya attached) → 409', async () => {
    // 1ª llamada: 2 accruals → crea payout.
    repo.listAccruals.mockResolvedValueOnce([{ commission_cents: 1000 }])
    repo.insertPayout.mockResolvedValue({ id: 'po-1' })
    await closePeriod(ctx, { practitionerId: PRAC, periodStart: 'x', periodEnd: 'y' })

    // 2ª llamada: los accruals ya están attached → repo devuelve 0 (status='accrued' filter).
    repo.listAccruals.mockResolvedValueOnce([])
    await expect(
      closePeriod(ctx, { practitionerId: PRAC, periodStart: 'x', periodEnd: 'y' }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(repo.insertPayout).toHaveBeenCalledTimes(1)
  })
})

// ── markPayoutPaid ───────────────────────────────────────────────────

describe('markPayoutPaid', () => {
  it('actualiza status="paid" + emite payout.paid event con externalRef', async () => {
    repo.setPayoutStatus.mockResolvedValue({ id: 'po-1', status: 'paid' })
    await markPayoutPaid(ctx, 'po-1', 'STRIPE_PAYOUT_xyz')
    expect(repo.setPayoutStatus).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'po-1', 'paid', 'STRIPE_PAYOUT_xyz',
    )
    expect(publish).toHaveBeenCalledWith({
      type: 'payout.paid',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        payoutId: 'po-1', externalRef: 'STRIPE_PAYOUT_xyz',
      },
    })
  })

  it('payout inexistente → NotFoundError', async () => {
    repo.setPayoutStatus.mockResolvedValue(null)
    await expect(markPayoutPaid(ctx, 'ghost', 'ref')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── handleScheduledPayout (event consumer) ───────────────────────────

describe('handleScheduledPayout — invocado por platform-scheduler', () => {
  it('procesa solo payout.period_due (ignora otros eventos)', async () => {
    await handleScheduledPayout({ type: 'order.created', payload: {} })
    expect(repo.listAccruals).not.toHaveBeenCalled()
  })

  it('ignora payloads incompletos (sin practitionerId / sin periodStart)', async () => {
    await handleScheduledPayout({
      type: 'payout.period_due',
      payload: { appId: 'yoga', tenantId: 't1' /* sin practitionerId */ },
    })
    expect(repo.listAccruals).not.toHaveBeenCalled()
  })

  it('payload completo → invoca closePeriod con ctx.role="system"', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 1000 }])
    repo.insertPayout.mockResolvedValue({ id: 'po-1' })

    await handleScheduledPayout({
      type: 'payout.period_due',
      payload: {
        appId: 'yoga', tenantId: 't1', practitionerId: PRAC,
        periodStart: '2026-04-01T00:00:00Z', periodEnd: '2026-05-01T00:00:00Z',
        scheduleId: 'sched-1',
      },
    })
    expect(repo.insertPayout).toHaveBeenCalledTimes(1)
  })

  it('CONFLICT "no accruals" se loguea pero NO propaga (resilience del scheduler)', async () => {
    repo.listAccruals.mockResolvedValue([])  // → ConflictError dentro de closePeriod
    await expect(handleScheduledPayout({
      type: 'payout.period_due',
      payload: {
        appId: 'yoga', tenantId: 't1', practitionerId: PRAC,
        periodStart: 'x', periodEnd: 'y',
      },
    })).resolves.toBeUndefined()    // no throw
  })
})
