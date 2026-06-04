// payment.service — PaymentIntent lifecycle + refunds + idempotency.
// Stripe SDK and the DB/Redis libs are mocked (same approach as splitpay).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const redisMock = vi.hoisted(() => ({
  checkIdempotency: vi.fn(),
  storeIdempotency: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/redis.js', () => ({ redis: {}, ...redisMock }))

const dbMock = vi.hoisted(() => ({
  pool: {},
  // withTenantTransaction(pool, appId, tenantId, subTenantId, fn) → fn(client)
  withTenantTransaction: vi.fn((_pool, _a, _t, _s, fn) => fn({})),
}))
vi.mock('../lib/db.js', () => dbMock)

const stripeMock = vi.hoisted(() => ({
  stripe: {
    paymentIntents: { create: vi.fn(), cancel: vi.fn(), capture: vi.fn() },
    refunds: { create: vi.fn() },
  },
  isStubbed: vi.fn(),
}))
vi.mock('../lib/stripe.js', () => stripeMock)

vi.mock('../repositories/transaction.repository.js')
vi.mock('../repositories/refund.repository.js')

import * as service from '../services/payment.service.js'
import * as txRepo from '../repositories/transaction.repository.js'
import * as refundRepo from '../repositories/refund.repository.js'

const ctx = { appId: 'aikikan', tenantId: 't-1', subTenantId: null, userId: 'u-1' }

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.checkIdempotency.mockResolvedValue(null)
  dbMock.withTenantTransaction.mockImplementation((_p, _a, _t, _s, fn) => fn({}))
})

describe('createPaymentIntent — idempotency', () => {
  it('cache HIT → returns cached result, never touches Stripe/DB', async () => {
    redisMock.checkIdempotency.mockResolvedValue(JSON.stringify({ transactionId: 'cached' }))
    const r = await service.createPaymentIntent(ctx, { amount: 5000, userId: 'u-1', idempotencyKey: 'k1' })
    expect(r).toEqual({ transactionId: 'cached' })
    expect(stripeMock.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(txRepo.insertTransaction).not.toHaveBeenCalled()
  })

  it('scopes the idempotency key by tenant before storing', async () => {
    stripeMock.isStubbed.mockReturnValue(true)
    txRepo.insertTransaction.mockResolvedValue({ id: 'tx-1' })
    await service.createPaymentIntent(ctx, { amount: 5000, currency: 'eur', userId: 'u-1', idempotencyKey: 'k1' })
    expect(redisMock.checkIdempotency).toHaveBeenCalledWith('aikikan:t-1:k1')
    expect(redisMock.storeIdempotency).toHaveBeenCalledWith('aikikan:t-1:k1', expect.objectContaining({ transactionId: 'tx-1' }))
  })
})

describe('createPaymentIntent — dev-stub mode (no Stripe key)', () => {
  beforeEach(() => stripeMock.isStubbed.mockReturnValue(true))

  it('mints a fake intent and persists a transaction without calling Stripe', async () => {
    txRepo.insertTransaction.mockResolvedValue({ id: 'tx-1' })
    const r = await service.createPaymentIntent(ctx, { amount: 5000, currency: 'eur', userId: 'u-1', idempotencyKey: 'k1' })
    expect(stripeMock.stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(r.stub).toBe(true)
    expect(r.providerTxId).toMatch(/^pi_stub_/)
    expect(txRepo.insertTransaction).toHaveBeenCalledWith({}, ctx, expect.objectContaining({
      providerTxId: r.providerTxId, amountCents: 5000, idempotencyKey: 'k1',
    }))
  })

  it('manual capture → status requires_capture', async () => {
    txRepo.insertTransaction.mockResolvedValue({ id: 'tx-1' })
    const r = await service.createPaymentIntent(ctx, { amount: 5000, currency: 'eur', userId: 'u-1', idempotencyKey: 'k1', captureMethod: 'manual' })
    expect(r.status).toBe('requires_capture')
  })
})

describe('createPaymentIntent — real Stripe', () => {
  beforeEach(() => {
    stripeMock.isStubbed.mockReturnValue(false)
    txRepo.insertTransaction.mockResolvedValue({ id: 'tx-1' })
  })

  it('calls Stripe with a tenant-scoped idempotency key and tenant metadata', async () => {
    stripeMock.stripe.paymentIntents.create.mockResolvedValue({ id: 'pi_real', client_secret: 'cs', status: 'requires_payment_method' })
    await service.createPaymentIntent({ ...ctx, subTenantId: 'st-9' }, { amount: 7000, currency: 'eur', userId: 'u-1', idempotencyKey: 'k1' })
    const [args, opts] = stripeMock.stripe.paymentIntents.create.mock.calls[0]
    expect(opts).toEqual({ idempotencyKey: 'pi_aikikan:t-1:k1' })
    expect(args.metadata).toMatchObject({ app_id: 'aikikan', tenant_id: 't-1', sub_tenant_id: 'st-9', user_id: 'u-1' })
    expect(args.automatic_payment_methods).toEqual({ enabled: true })
  })

  it('Stripe throws → StripeError, no DB insert, no idempotency store', async () => {
    stripeMock.stripe.paymentIntents.create.mockRejectedValue(new Error('card_declined'))
    await expect(service.createPaymentIntent(ctx, { amount: 5000, currency: 'eur', userId: 'u-1', idempotencyKey: 'k1' }))
      .rejects.toThrow(/Failed to create payment intent/)
    expect(txRepo.insertTransaction).not.toHaveBeenCalled()
    expect(redisMock.storeIdempotency).not.toHaveBeenCalled()
  })
})

describe('cancelIntent', () => {
  it('rejects cancelling a succeeded payment', async () => {
    stripeMock.isStubbed.mockReturnValue(true)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'succeeded', providerTxId: 'pi_stub_x' })
    await expect(service.cancelIntent(ctx, 'tx-1')).rejects.toThrow(/Cannot cancel/)
  })

  it('stub intent → updates status to canceled without calling Stripe', async () => {
    stripeMock.isStubbed.mockReturnValue(true)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'requires_payment_method', providerTxId: 'pi_stub_x' })
    txRepo.updateStatus.mockResolvedValue({ id: 'tx-1', status: 'canceled' })
    const r = await service.cancelIntent(ctx, 'tx-1')
    expect(r.status).toBe('canceled')
    expect(stripeMock.stripe.paymentIntents.cancel).not.toHaveBeenCalled()
  })

  it('real intent → calls Stripe cancel', async () => {
    stripeMock.isStubbed.mockReturnValue(false)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'requires_payment_method', providerTxId: 'pi_real' })
    txRepo.updateStatus.mockResolvedValue({ id: 'tx-1', status: 'canceled' })
    await service.cancelIntent(ctx, 'tx-1')
    expect(stripeMock.stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_real')
  })
})

describe('captureIntent', () => {
  it('rejects capturing a non-authorized payment', async () => {
    stripeMock.isStubbed.mockReturnValue(true)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'requires_payment_method', providerTxId: 'pi_stub_x' })
    await expect(service.captureIntent(ctx, 'tx-1')).rejects.toThrow(/Cannot capture/)
  })

  it('rejects amountToCapture above authorized', async () => {
    stripeMock.isStubbed.mockReturnValue(true)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'requires_capture', amountCents: 5000, providerTxId: 'pi_stub_x' })
    await expect(service.captureIntent(ctx, 'tx-1', 9000)).rejects.toThrow(/exceeds/)
  })

  it('real intent → calls Stripe capture with amount + idempotency key', async () => {
    stripeMock.isStubbed.mockReturnValue(false)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'requires_capture', amountCents: 5000, providerTxId: 'pi_real' })
    txRepo.updateStatus.mockResolvedValue({ id: 'tx-1', status: 'succeeded' })
    await service.captureIntent(ctx, 'tx-1', 4000)
    expect(stripeMock.stripe.paymentIntents.capture).toHaveBeenCalledWith('pi_real', { amount_to_capture: 4000 }, { idempotencyKey: 'cap_tx-1' })
  })
})

describe('createRefund — cumulative-safe', () => {
  beforeEach(() => {
    redisMock.checkIdempotency.mockResolvedValue(null)
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'succeeded', amountCents: 10000, currency: 'eur', providerTxId: 'pi_real' })
  })

  it('rejects refunding a non-succeeded transaction', async () => {
    txRepo.findById.mockResolvedValue({ id: 'tx-1', status: 'pending', amountCents: 10000 })
    await expect(service.createRefund(ctx, 'tx-1', { idempotencyKey: 'r1' })).rejects.toThrow(/succeeded/)
  })

  it('rejects refund exceeding remaining amount', async () => {
    refundRepo.sumRefundedCents.mockResolvedValue(8000)
    stripeMock.isStubbed.mockReturnValue(true)
    await expect(service.createRefund(ctx, 'tx-1', { amount: 5000, idempotencyKey: 'r1' }))
      .rejects.toThrow(/exceeds the remaining/)
  })

  it('partial refund → marks transaction partially_refunded', async () => {
    refundRepo.sumRefundedCents.mockResolvedValue(0)
    stripeMock.isStubbed.mockReturnValue(true)
    refundRepo.insertRefund.mockResolvedValue({ id: 'rf-1' })
    txRepo.updateStatus.mockResolvedValue({})
    const r = await service.createRefund(ctx, 'tx-1', { amount: 4000, idempotencyKey: 'r1' })
    expect(r.amountCents).toBe(4000)
    expect(txRepo.updateStatus).toHaveBeenCalledWith({}, ctx, 'tx-1', 'partially_refunded')
  })

  it('refund of full remaining → marks transaction refunded', async () => {
    refundRepo.sumRefundedCents.mockResolvedValue(6000)
    stripeMock.isStubbed.mockReturnValue(true)
    refundRepo.insertRefund.mockResolvedValue({ id: 'rf-1' })
    txRepo.updateStatus.mockResolvedValue({})
    await service.createRefund(ctx, 'tx-1', { idempotencyKey: 'r1' }) // remaining = 4000
    expect(refundRepo.insertRefund).toHaveBeenCalledWith({}, ctx, expect.objectContaining({ amountCents: 4000 }))
    expect(txRepo.updateStatus).toHaveBeenCalledWith({}, ctx, 'tx-1', 'refunded')
  })

  it('real Stripe refund → uses ref_ idempotency key + tenant metadata', async () => {
    refundRepo.sumRefundedCents.mockResolvedValue(0)
    stripeMock.isStubbed.mockReturnValue(false)
    stripeMock.stripe.refunds.create.mockResolvedValue({ id: 're_real', status: 'succeeded' })
    refundRepo.insertRefund.mockResolvedValue({ id: 'rf-1' })
    txRepo.updateStatus.mockResolvedValue({})
    await service.createRefund(ctx, 'tx-1', { amount: 3000, reason: 'requested_by_customer', idempotencyKey: 'r1' })
    const [args, opts] = stripeMock.stripe.refunds.create.mock.calls[0]
    expect(opts).toEqual({ idempotencyKey: 'ref_aikikan:t-1:r1' })
    expect(args).toMatchObject({ payment_intent: 'pi_real', amount: 3000, reason: 'requested_by_customer' })
    expect(args.metadata).toMatchObject({ app_id: 'aikikan', tenant_id: 't-1', transaction_id: 'tx-1' })
  })

  it('idempotency cache HIT → returns cached refund without DB/Stripe', async () => {
    redisMock.checkIdempotency.mockResolvedValue(JSON.stringify({ refundId: 'cached' }))
    const r = await service.createRefund(ctx, 'tx-1', { idempotencyKey: 'r1' })
    expect(r).toEqual({ refundId: 'cached' })
    expect(refundRepo.insertRefund).not.toHaveBeenCalled()
  })
})
