// payment.service.createPaymentIntent + createAdditionalTransfers.
// Foco en lo NO testeado por idempotency / refunds / checkout / split-engine.
//
// Contrato createPaymentIntent:
//   - Idempotencia: cache HIT → return cached parsed sin tocar Stripe/DB.
//   - stripe.paymentIntents.create con application_fee_amount + transfer_data.destination.
//   - idempotencyKey con prefijo "pi_<input.idempotencyKey>" (anti collision con refund).
//   - metadata: tenant_id + sub_tenant_id + split_rule_id + user metadata.
//   - Stripe falla → StripeError "Failed to create payment intent".
//   - Split sin recipients → StripeError "no recipients".
//
// Contrato createAdditionalTransfers:
//   - Payment no existe → warn + return (no throw).
//   - Split rule no existe → silent return.
//   - 1 recipient → no additional transfers (ya cubierto por transfer_data primary).
//   - N recipients (N > 1) → N-1 transfers con idempotencyKey "tr_<paymentId>_<accountId>".
//   - Error en 1 transfer → log.error pero CONTINÚA con los demás.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    SPLITPAY_STRIPE_SECRET_KEY: 'sk_test',
    SPLITPAY_STRIPE_WEBHOOK_SECRET: 'whsec',
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const fakeClient = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
}))
const redisMock = vi.hoisted(() => ({
  checkIdempotency: vi.fn(),
  storeIdempotency: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/redis.js', () => ({ redis: {}, ...redisMock }))
const stripeMock = vi.hoisted(() => ({
  paymentIntents: { create: vi.fn() },
  transfers: { create: vi.fn(), list: vi.fn() },
  refunds: { create: vi.fn() },
}))
vi.mock('../lib/stripe.js', () => ({ stripe: stripeMock }))
const publishMock = vi.hoisted(() => vi.fn())
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: publishMock }))
vi.mock('../repositories/payment.repository.js')
vi.mock('../repositories/split-rule.repository.js')

import { createPaymentIntent, createAdditionalTransfers } from '../services/payment.service.js'
import * as paymentRepo from '../repositories/payment.repository.js'
import * as splitRuleRepo from '../repositories/split-rule.repository.js'
import { logger } from '../lib/logger.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  fakeClient.query.mockResolvedValue({ rows: [] })
  redisMock.checkIdempotency.mockResolvedValue(null)
})

// ── createPaymentIntent — idempotency ──────────────────────────────

describe('createPaymentIntent — idempotency cache', () => {
  it('cache HIT → return parsed sin tocar Stripe/DB', async () => {
    redisMock.checkIdempotency.mockResolvedValue(JSON.stringify({
      clientSecret: 'cached_secret', paymentId: 'cached-pay-id',
    }))
    const r = await createPaymentIntent(ctx, { idempotencyKey: 'k1', amount: 5000 })
    expect(r).toEqual({ clientSecret: 'cached_secret', paymentId: 'cached-pay-id' })
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled()
    expect(paymentRepo.insertPayment).not.toHaveBeenCalled()
  })

  it('cache MISS → ejecuta + storeIdempotency', async () => {
    splitRuleRepo.findSplitRuleById.mockResolvedValue({
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
      platformFeePercent: 10,
    })
    stripeMock.paymentIntents.create.mockResolvedValue({
      id: 'pi_xyz', client_secret: 'cs_xyz', status: 'requires_action',
    })
    paymentRepo.insertPayment.mockResolvedValue({ id: 'pay-1' })

    await createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    expect(redisMock.storeIdempotency).toHaveBeenCalledWith('k1', expect.objectContaining({
      paymentId: 'pay-1', clientSecret: 'cs_xyz',
    }))
  })
})

// ── Stripe paymentIntents.create — shape ────────────────────────────

describe('stripe.paymentIntents.create — args', () => {
  beforeEach(() => {
    splitRuleRepo.findSplitRuleById.mockResolvedValue({
      recipients: [
        { accountId: 'acct_merchant', label: 'Merchant', percentage: 80 },
        { accountId: 'acct_platform', label: 'Platform', percentage: 20 },
      ],
      platformFeePercent: 10,
    })
    stripeMock.paymentIntents.create.mockResolvedValue({
      id: 'pi_xyz', client_secret: 'cs_xyz', status: 'requires_payment_method',
    })
    paymentRepo.insertPayment.mockResolvedValue({ id: 'pay-1' })
  })

  it('transfer_data.destination = primer recipient (acct_merchant)', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer_data: { destination: 'acct_merchant' },
      }),
      expect.anything(),
    )
  })

  it('application_fee_amount = platformFee del simulación (no flat)', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    const arg0 = stripeMock.paymentIntents.create.mock.calls[0][0]
    expect(typeof arg0.application_fee_amount).toBe('number')
    expect(arg0.application_fee_amount).toBeGreaterThan(0)
  })

  it('metadata incluye tenant_id + sub_tenant_id + split_rule_id + user metadata', async () => {
    await createPaymentIntent({ ...ctx, subTenantId: 'st-xyz' }, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
      metadata: { order_id: 'ord-42', source: 'portal' },
    })
    const arg0 = stripeMock.paymentIntents.create.mock.calls[0][0]
    expect(arg0.metadata).toMatchObject({
      tenant_id: ctx.tenantId,
      sub_tenant_id: 'st-xyz',
      split_rule_id: 'rule-1',
      order_id: 'ord-42',
      source: 'portal',
    })
  })

  it('subTenantId ausente → metadata.sub_tenant_id = "" (empty string, no null)', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    const arg0 = stripeMock.paymentIntents.create.mock.calls[0][0]
    expect(arg0.metadata.sub_tenant_id).toBe('')
  })

  it('idempotencyKey con prefijo "pi_" (anti collision con refund "ref_")', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'order-42', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.anything(),
      { idempotencyKey: 'pi_order-42' },
    )
  })

  it('automatic_payment_methods.enabled = true (Stripe routing)', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    const arg0 = stripeMock.paymentIntents.create.mock.calls[0][0]
    expect(arg0.automatic_payment_methods).toEqual({ enabled: true })
  })

  it('transfer_group explícito = "pi_<idempotencyKey>" + persistido en la transacción (priority #1)', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'order-99', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    const arg0 = stripeMock.paymentIntents.create.mock.calls[0][0]
    expect(arg0.transfer_group).toBe('pi_order-99')
    expect(paymentRepo.insertPayment).toHaveBeenCalledWith(
      expect.anything(), ctx,
      expect.objectContaining({ transferGroup: 'pi_order-99' }),
    )
  })

  it('metadata.app_id propagado desde el ctx (para resolver eventos en webhooks)', async () => {
    await createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })
    const arg0 = stripeMock.paymentIntents.create.mock.calls[0][0]
    expect(arg0.metadata.app_id).toBe('shop')
  })
})

// ── Stripe fail ────────────────────────────────────────────────────

describe('Stripe paymentIntents.create falla', () => {
  it('Stripe throw → StripeError "Failed to create payment intent"', async () => {
    splitRuleRepo.findSplitRuleById.mockResolvedValue({
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
      platformFeePercent: 10,
    })
    stripeMock.paymentIntents.create.mockRejectedValue(new Error('card_declined'))
    await expect(createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })).rejects.toThrow(/Failed to create payment intent/)
    expect(paymentRepo.insertPayment).not.toHaveBeenCalled()
    expect(redisMock.storeIdempotency).not.toHaveBeenCalled()
  })

  it('Split sin recipients → StripeError "no recipients"', async () => {
    splitRuleRepo.findSplitRuleById.mockResolvedValue({
      recipients: [], platformFeePercent: 10,
    })
    await expect(createPaymentIntent(ctx, {
      idempotencyKey: 'k1', amount: 5000, currency: 'eur', splitRuleId: 'rule-1',
    })).rejects.toThrow(/no recipients/)
  })
})

// ── createAdditionalTransfers ──────────────────────────────────────

describe('createAdditionalTransfers', () => {
  it('payment no encontrado → warn + return sin throw', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue(null)
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(logger.warn).toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('split rule no existe → silent return', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'ghost', amount: 5000, platformFee: 500,
    })
    fakeClient.query.mockResolvedValue({ rows: [] })   // SELECT rule → empty
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('1 recipient → no additional transfers (cubierto por primary transfer_data)', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 5000, platformFee: 500,
      currency: 'eur', tenantId: 't1',
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([{ accountId: 'a1', label: 'A', percentage: 100 }]),
        platform_fee_percent: '10',
      }],
    })
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('3 recipients → 2 transfers (skip primer, ya está en transfer_data)', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 10000, platformFee: 1000,
      currency: 'eur', tenantId: 't1',
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'a1', label: 'Primary',   percentage: 50 },
          { accountId: 'a2', label: 'Secondary', percentage: 30 },
          { accountId: 'a3', label: 'Tertiary',  percentage: 20 },
        ]),
        platform_fee_percent: '10',
      }],
    })
    stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2)
  })

  it('idempotencyKey = "tr_<paymentId>_<accountId>" (anti dobles transfers)', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 10000, platformFee: 1000,
      currency: 'eur', tenantId: 't1',
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'a1', label: 'A', percentage: 60 },
          { accountId: 'a2', label: 'B', percentage: 40 },
        ]),
        platform_fee_percent: '10',
      }],
    })
    stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).toHaveBeenCalledWith(
      expect.anything(),
      { idempotencyKey: 'tr_pay-1_a2' },
    )
  })

  it('recipient adicional con amount <= 0 → continue (no crea transfer)', async () => {
    // a1 al 100% absorbe todo el neto; a2 y a3 quedan en 0 → la guarda
    // `recipientAmount.amount <= 0` salta ambos (línea 121).
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 10000, platformFee: 1000,
      currency: 'eur', tenantId: 't1',
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'a1', label: 'A', percentage: 100 },
          { accountId: 'a2', label: 'B', percentage: 0 },
          { accountId: 'a3', label: 'C', percentage: 0 },
        ]),
        platform_fee_percent: '10',
      }],
    })
    stripeMock.transfers.create.mockResolvedValue({ id: 'tr_x' })
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('error en 1 transfer → log.error pero CONTINÚA con los demás', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 10000, platformFee: 1000,
      currency: 'eur', tenantId: 't1',
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'a1', label: 'A', percentage: 33 },
          { accountId: 'a2', label: 'B', percentage: 33 },
          { accountId: 'a3', label: 'C', percentage: 34 },
        ]),
        platform_fee_percent: '10',
      }],
    })
    stripeMock.transfers.create
      .mockRejectedValueOnce(new Error('Insufficient funds'))
      .mockResolvedValueOnce({ id: 'tr_2' })
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalled()
  })

  it('transfer fallida con app_id en metadata → emite splitpay.transfer.failed (priority #4)', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 10000, platformFee: 1000,
      currency: 'eur', tenantId: 't1', subTenantId: null,
      transferGroup: 'pi_tg', metadata: { app_id: 'shop' },
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'a1', label: 'A', percentage: 50 },
          { accountId: 'a2', label: 'B', percentage: 50 },
        ]),
        platform_fee_percent: '10',
      }],
    })
    stripeMock.transfers.create.mockRejectedValueOnce(new Error('Insufficient funds'))
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(publishMock).toHaveBeenCalledWith({}, 'shop', expect.objectContaining({
      type: 'splitpay.transfer.failed',
      payload: expect.objectContaining({ paymentId: 'pay-1', accountId: 'a2' }),
    }))
  })

  it('transfer con transfer_group propaga transfer_group a stripe.transfers.create (priority #1)', async () => {
    paymentRepo.findPaymentByStripeId.mockResolvedValue({
      id: 'pay-1', splitRuleId: 'rule-1', amount: 10000, platformFee: 1000,
      currency: 'eur', tenantId: 't1', transferGroup: 'pi_grp', metadata: {},
    })
    fakeClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'a1', label: 'A', percentage: 60 },
          { accountId: 'a2', label: 'B', percentage: 40 },
        ]),
        platform_fee_percent: '10',
      }],
    })
    stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
    await createAdditionalTransfers('pi_xyz', 'ch_xyz')
    expect(stripeMock.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ transfer_group: 'pi_grp' }),
      expect.anything(),
    )
  })
})
