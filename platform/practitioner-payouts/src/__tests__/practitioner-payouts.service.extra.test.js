// practitioner-payouts.service — cobertura de funciones no tocadas por el test
// base: createAccrual, listAccruals, listPayouts, getPayout(404),
// markPayoutPaid(404), handleScheduledPayout, exportPayoutPdf.
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
vi.mock('@apphub/platform-sdk/simple-pdf', () => ({
  createTextPdf: vi.fn(() => Buffer.from('PDF')),
}))

import * as service from '../services/practitioner-payouts.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/practitioner-payouts.repository.js'
import { createTextPdf } from '@apphub/platform-sdk/simple-pdf'
import { logger } from '../lib/logger.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'clinic'
const TEN = 't1'
const PRAC = 'prac1'
const PAY = 'pay1'

const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('createAccrual / listAccruals / listPayouts', () => {
  it('createAccrual delega en el repo', async () => {
    repo.insertAccrual.mockResolvedValue({ id: 'a1' })
    expect(await service.createAccrual(ctx, { practitionerId: PRAC, grossCents: 1000, commissionCents: 300 })).toEqual({ id: 'a1' })
    expect(repo.insertAccrual).toHaveBeenCalledWith(expect.anything(), APP, TEN, expect.objectContaining({ practitionerId: PRAC }))
  })

  it('listAccruals delega en el repo', async () => {
    repo.listAccruals.mockResolvedValue([{ id: 'a1' }])
    expect(await service.listAccruals(ctx, { status: 'accrued' })).toEqual([{ id: 'a1' }])
  })

  it('listPayouts delega en el repo', async () => {
    repo.listPayouts.mockResolvedValue([{ id: PAY }])
    expect(await service.listPayouts(ctx, { status: 'pending' })).toEqual([{ id: PAY }])
  })
})

describe('getPayout / markPayoutPaid — branches de error', () => {
  it('getPayout NotFoundError', async () => {
    repo.findPayoutById.mockResolvedValue(null)
    await expect(service.getPayout(ctx, PAY)).rejects.toThrow(NotFoundError)
  })

  it('markPayoutPaid NotFoundError cuando setPayoutStatus → null', async () => {
    repo.setPayoutStatus.mockResolvedValue(null)
    await expect(service.markPayoutPaid(ctx, PAY)).rejects.toThrow(NotFoundError)
  })

  it('markPayoutPaid publica payout.paid', async () => {
    repo.setPayoutStatus.mockResolvedValue({ id: PAY, status: 'paid' })
    await service.markPayoutPaid(ctx, PAY, 'ext1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'payout.paid' }))
  })
})

describe('handleScheduledPayout', () => {
  it('ignora eventos de otro tipo', async () => {
    await service.handleScheduledPayout({ type: 'other', payload: {} })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('ignora payload incompleto', async () => {
    await service.handleScheduledPayout({ type: 'payout.period_due', payload: { appId: APP } })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('ejecuta closePeriod con accruals presentes', async () => {
    repo.listAccruals.mockResolvedValue([{ commission_cents: 500 }])
    repo.insertPayout.mockResolvedValue({ id: PAY })
    repo.attachAccrualsToPayout.mockResolvedValue(500)
    await service.handleScheduledPayout({
      type: 'payout.period_due',
      payload: { appId: APP, tenantId: TEN, practitionerId: PRAC, periodStart: 's', periodEnd: 'e' },
    })
    expect(repo.insertPayout).toHaveBeenCalled()
  })

  it('CONFLICT (sin accruals) → log info, no relanza', async () => {
    repo.listAccruals.mockResolvedValue([])
    await service.handleScheduledPayout({
      type: 'payout.period_due',
      payload: { appId: APP, tenantId: TEN, practitionerId: PRAC, periodStart: 's', periodEnd: 'e', scheduleId: 'sch1' },
    })
    expect(logger.info).toHaveBeenCalled()
  })

  it('error inesperado de closePeriod → log warn, no relanza', async () => {
    withTenantTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(service.handleScheduledPayout({
      type: 'payout.period_due',
      payload: { appId: APP, tenantId: TEN, practitionerId: PRAC, periodStart: 's', periodEnd: 'e', scheduleId: 'sch1' },
    })).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('exportPayoutPdf', () => {
  it('NotFoundError cuando el payout no existe', async () => {
    repo.findPayoutById.mockResolvedValue(null)
    await expect(service.exportPayoutPdf(ctx, PAY)).rejects.toThrow(NotFoundError)
  })

  it('genera el PDF con líneas de cabecera + devengos (con external_ref)', async () => {
    repo.findPayoutById.mockResolvedValue({
      id: PAY, practitioner_id: PRAC, period_start: '2026-01-01', period_end: '2026-02-01',
      status: 'paid', external_ref: 'ext1', currency: 'EUR',
      gross_amount_cents: 10000, net_amount_cents: 7000,
    })
    repo.listAccruals.mockResolvedValue([
      { created_at: '2026-01-15', booking_id: 'abcdef1234', amount_cents: 3000, status: 'paid' },
      { created_at: '2026-01-20', booking_id: null, amount_cents: null, status: 'paid' },
    ])
    const r = await service.exportPayoutPdf(ctx, PAY)
    expect(createTextPdf).toHaveBeenCalled()
    const { lines } = createTextPdf.mock.calls[0][0]
    expect(lines.some((l) => l.includes('Referencia externa: ext1'))).toBe(true)
    expect(lines.some((l) => l.includes('Devengos del periodo (2)'))).toBe(true)
    expect(r.filename).toMatch(/^payout-/)
    expect(r.pdf).toBeInstanceOf(Buffer)
  })

  it('omite la referencia externa cuando no existe y usa currency fallback', async () => {
    repo.findPayoutById.mockResolvedValue({
      id: PAY, practitioner_id: PRAC, period_start: '2026-01-01', period_end: '2026-02-01',
      status: 'pending', external_ref: null, currency: null,
      gross_amount_cents: null, net_amount_cents: null,
    })
    repo.listAccruals.mockResolvedValue([])
    await service.exportPayoutPdf(ctx, PAY)
    const { lines } = createTextPdf.mock.calls[0][0]
    expect(lines.some((l) => l.includes('Referencia externa'))).toBe(false)
    expect(lines.some((l) => l.includes('Moneda: EUR'))).toBe(true)
  })
})

describe('practitioner-payouts.service — ramas restantes', () => {
  it('getPayout encontrado → devuelve el payout (rama success, línea 73)', async () => {
    repo.findPayoutById.mockResolvedValue({ id: PAY, status: 'pending' })
    const out = await service.getPayout(ctx, PAY)
    expect(out).toEqual({ id: PAY, status: 'pending' })
  })

  it('handleScheduledPayout sin payload → `?? {}` y early-return', async () => {
    await service.handleScheduledPayout({ type: 'payout.period_due' })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('handleScheduledPayout payload sin tenantId → early-return (rama || media)', async () => {
    await service.handleScheduledPayout({ type: 'payout.period_due', payload: { appId: APP } })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('handleScheduledPayout payload sin practitionerId → early-return', async () => {
    await service.handleScheduledPayout({ type: 'payout.period_due', payload: { appId: APP, tenantId: TEN } })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('handleScheduledPayout payload sin periodStart/End → early-return', async () => {
    await service.handleScheduledPayout({ type: 'payout.period_due', payload: { appId: APP, tenantId: TEN, practitionerId: PRAC } })
    expect(withTenantTransaction).not.toHaveBeenCalled()
    await service.handleScheduledPayout({ type: 'payout.period_due', payload: { appId: APP, tenantId: TEN, practitionerId: PRAC, periodStart: 's' } })
  })

  it('handleScheduledPayout con evento que lanza (null) → catch externo, log warn', async () => {
    await expect(service.handleScheduledPayout(null)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })
})
