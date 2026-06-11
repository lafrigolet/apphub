// webhook.service — signature construction, event dedup, status sync.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const redisMock = vi.hoisted(() => ({ publish: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/redis.js', () => ({ redis: {}, ...redisMock }))

const dbMock = vi.hoisted(() => ({
  pool: {},
  withTransaction: vi.fn((_p, fn) => fn({})),
  withTenantTransaction: vi.fn((_p, _a, _t, _s, fn) => fn({})),
}))
vi.mock('../lib/db.js', () => dbMock)

const stripeMock = vi.hoisted(() => ({
  stripe: { webhooks: { constructEvent: vi.fn() } },
  getWebhookSecret: vi.fn(),
}))
vi.mock('../lib/stripe.js', () => stripeMock)

vi.mock('../repositories/transaction.repository.js')
vi.mock('../repositories/refund.repository.js')
vi.mock('../repositories/webhook-event.repository.js')

import { constructWebhookEvent, handleWebhookEvent } from '../services/webhook.service.js'
import * as txRepo from '../repositories/transaction.repository.js'
import * as refundRepo from '../repositories/refund.repository.js'
import * as eventRepo from '../repositories/webhook-event.repository.js'

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.withTransaction.mockImplementation((_p, fn) => fn({}))
  dbMock.withTenantTransaction.mockImplementation((_p, _a, _t, _s, fn) => fn({}))
  eventRepo.recordReceived.mockResolvedValue(true)
  eventRepo.markProcessed.mockResolvedValue(undefined)
  eventRepo.markFailed.mockResolvedValue(undefined)
})

describe('constructWebhookEvent — signature verification', () => {
  it('throws when no webhook secret configured', async () => {
    stripeMock.getWebhookSecret.mockResolvedValue(null)
    await expect(constructWebhookEvent('body', 'sig')).rejects.toThrow(/webhook secret not configured/)
  })

  it('delegates to Stripe constructEvent with the configured secret', async () => {
    stripeMock.getWebhookSecret.mockResolvedValue('whsec_x')
    stripeMock.stripe.webhooks.constructEvent.mockReturnValue({ id: 'evt_1' })
    const ev = await constructWebhookEvent('raw', 'sig')
    expect(stripeMock.stripe.webhooks.constructEvent).toHaveBeenCalledWith('raw', 'sig', 'whsec_x')
    expect(ev).toEqual({ id: 'evt_1' })
  })
})

describe('handleWebhookEvent — dedup', () => {
  it('drops a duplicate event (already recorded)', async () => {
    eventRepo.recordReceived.mockResolvedValue(false)
    await handleWebhookEvent({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } })
    expect(txRepo.updateStatusByProviderTxId).not.toHaveBeenCalled()
    expect(eventRepo.markProcessed).not.toHaveBeenCalled()
  })

  it('marks the event processed after a successful handle', async () => {
    txRepo.updateStatusByProviderTxId.mockResolvedValue({ id: 'tx-1', amountCents: 5000, currency: 'eur' })
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { app_id: 'a', tenant_id: 't' } } },
    })
    expect(eventRepo.markProcessed).toHaveBeenCalledWith({}, 'evt_1')
  })

  it('marks the event failed and rethrows when a handler throws', async () => {
    txRepo.updateStatusByProviderTxId.mockRejectedValue(new Error('boom'))
    await expect(handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { app_id: 'a', tenant_id: 't' } } },
    })).rejects.toThrow('boom')
    expect(eventRepo.markFailed).toHaveBeenCalledWith({}, 'evt_1', 'boom')
  })
})

describe('handleWebhookEvent — status sync', () => {
  it('payment_intent.succeeded → updates tx + publishes payment.succeeded', async () => {
    txRepo.updateStatusByProviderTxId.mockResolvedValue({ id: 'tx-1', amountCents: 5000, currency: 'eur' })
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { app_id: 'a', tenant_id: 't' } } },
    })
    expect(txRepo.updateStatusByProviderTxId).toHaveBeenCalledWith({}, 'pi_1', 'succeeded', null)
    expect(redisMock.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment.succeeded' }))
  })

  it('payment_intent.payment_failed → status failed with error code', async () => {
    txRepo.updateStatusByProviderTxId.mockResolvedValue({ id: 'tx-1', amountCents: 5000, currency: 'eur' })
    await handleWebhookEvent({
      id: 'evt_2', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_2', metadata: { app_id: 'a', tenant_id: 't' }, last_payment_error: { code: 'card_declined' } } },
    })
    expect(txRepo.updateStatusByProviderTxId).toHaveBeenCalledWith({}, 'pi_2', 'failed', 'card_declined')
  })

  it('intent without tenant metadata → skipped, no update', async () => {
    await handleWebhookEvent({
      id: 'evt_3', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_3', metadata: {} } },
    })
    expect(txRepo.updateStatusByProviderTxId).not.toHaveBeenCalled()
  })

  it('charge.refund.updated → syncs refund status', async () => {
    refundRepo.updateStatusByProviderRefundId.mockResolvedValue({ id: 'rf-1', status: 'succeeded' })
    await handleWebhookEvent({
      id: 'evt_4', type: 'charge.refund.updated',
      data: { object: { id: 're_1', status: 'succeeded', metadata: { app_id: 'a', tenant_id: 't' } } },
    })
    expect(refundRepo.updateStatusByProviderRefundId).toHaveBeenCalledWith({}, 're_1', 'succeeded')
  })

  it('checkout.session.completed (paid) → tx succeeded + payment.succeeded', async () => {
    txRepo.updateStatusByProviderTxId.mockResolvedValue({ id: 'tx-9', amountCents: 1234, currency: 'eur' })
    await handleWebhookEvent({
      id: 'evt_6', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_9', metadata: { app_id: 'a', tenant_id: 't' } } },
    })
    expect(txRepo.updateStatusByProviderTxId).toHaveBeenCalledWith({}, 'cs_1', 'succeeded', null)
    expect(redisMock.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payment.succeeded',
      payload: expect.objectContaining({ providerTxId: 'cs_1', paymentIntentId: 'pi_9' }),
    }))
  })

  it('checkout.session.completed (unpaid/async) → stays pending', async () => {
    txRepo.updateStatusByProviderTxId.mockResolvedValue({ id: 'tx-9', amountCents: 1234, currency: 'eur' })
    await handleWebhookEvent({
      id: 'evt_7', type: 'checkout.session.completed',
      data: { object: { id: 'cs_2', payment_status: 'unpaid', metadata: { app_id: 'a', tenant_id: 't' } } },
    })
    expect(txRepo.updateStatusByProviderTxId).toHaveBeenCalledWith({}, 'cs_2', 'pending', null)
  })

  it('checkout.session.expired → tx expired', async () => {
    txRepo.updateStatusByProviderTxId.mockResolvedValue({ id: 'tx-9', amountCents: 1234, currency: 'eur' })
    await handleWebhookEvent({
      id: 'evt_8', type: 'checkout.session.expired',
      data: { object: { id: 'cs_3', metadata: { app_id: 'a', tenant_id: 't' } } },
    })
    expect(txRepo.updateStatusByProviderTxId).toHaveBeenCalledWith({}, 'cs_3', 'expired', null)
  })

  it('unknown event type → no-op but still marked processed', async () => {
    await handleWebhookEvent({ id: 'evt_5', type: 'invoice.created', data: { object: {} } })
    expect(eventRepo.markProcessed).toHaveBeenCalledWith({}, 'evt_5')
  })
})
