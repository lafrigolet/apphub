// #6 — Export CSV de transacciones (service). El repo se cubre en
// payment.repository.test.js (allí se usa el repo real).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── service: exportPaymentsCsv ────────────────────────────────────────────────

const { fakeClient } = vi.hoisted(() => ({ fakeClient: { query: vi.fn(), release: vi.fn() } }))
vi.mock('../lib/env.js', () => ({ env: { SPLITPAY_STRIPE_SECRET_KEY: 'sk_test' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn().mockResolvedValue(fakeClient) } }))
vi.mock('../lib/redis.js', () => ({ redis: {}, checkIdempotency: vi.fn(), storeIdempotency: vi.fn() }))
vi.mock('../lib/stripe.js', () => ({ stripe: {} }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: vi.fn() }))
vi.mock('../repositories/payment.repository.js')
vi.mock('../repositories/split-rule.repository.js')
vi.mock('../repositories/config.repository.js')

import { exportPaymentsCsv } from '../services/payment.service.js'
import * as paymentRepo from '../repositories/payment.repository.js'

const ctx = { tenantId: 't1', subTenantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  fakeClient.release.mockClear()
})

describe('#6 — payment.service.exportPaymentsCsv', () => {
  it('sin transacciones → solo la cabecera', async () => {
    paymentRepo.listPaymentsForExport.mockResolvedValue([])
    const csv = await exportPaymentsCsv(ctx)
    expect(csv).toBe('id,created_at,status,amount,currency,platform_fee,merchant_account_id,split_rule_id,stripe_payment_intent_id,transfer_group\n')
  })

  it('serializa filas + escapa valores con comas/comillas', async () => {
    paymentRepo.listPaymentsForExport.mockResolvedValue([
      {
        id: 'p1', createdAt: '2026-01-01T00:00:00.000Z', status: 'succeeded',
        amount: 5000, currency: 'eur', platformFee: 145, merchantAccountId: 'acct_1',
        splitRuleId: 'r1', stripePaymentIntentId: 'pi_1', transferGroup: 'pi_idem,with-comma',
      },
    ])
    const csv = await exportPaymentsCsv(ctx)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('p1,2026-01-01T00:00:00.000Z,succeeded,5000,eur,145,acct_1,r1,pi_1,')
    // El valor con coma va entre comillas.
    expect(lines[1]).toContain('"pi_idem,with-comma"')
  })

  it('propaga from/to/limit al repo y libera el client', async () => {
    paymentRepo.listPaymentsForExport.mockResolvedValue([])
    await exportPaymentsCsv(ctx, { from: 'a', to: 'b', limit: 7 })
    expect(paymentRepo.listPaymentsForExport).toHaveBeenCalledWith(fakeClient, ctx, { from: 'a', to: 'b', limit: 7 })
    expect(fakeClient.release).toHaveBeenCalled()
  })

  it('libera el client incluso si el repo lanza', async () => {
    paymentRepo.listPaymentsForExport.mockRejectedValue(new Error('db down'))
    await expect(exportPaymentsCsv(ctx)).rejects.toThrow('db down')
    expect(fakeClient.release).toHaveBeenCalled()
  })
})
