// handleWebhookEvent — dispatch por event.type a su handler dedicado.
// Contrato:
//   - checkout.session.completed → markCompleted + emit splitpay.checkout.completed.
//   - invoice.paid → emit splitpay.invoice.paid (con periodStart/periodEnd ISO).
//   - invoice.payment_failed → emit splitpay.invoice.payment_failed.
//   - customer.subscription.updated/deleted → emit splitpay.subscription.{updated,deleted}.
//   - payment_intent.succeeded → updatePaymentStatus + createAdditionalTransfers.
//   - account.updated → syncAccountFromStripe.
//   - event.type desconocido → debug log + no-op (no crash).
//   - appId se resuelve desde metadata.app_id (o desde checkout_sessions.metadata.app_id).
//   - Si NO se resuelve appId Y NO es platform_subscription → warn + skip emit (sin throw).
//
// LÍMITES CONOCIDOS (anti-features documentados con .todo):
//   - NO hay dedup por event.id en el handler. Un replay del MISMO event llega
//     al handler de tipo otra vez. Stripe garantiza idempotencia a nivel de
//     state actual (e.g. payment_intent.succeeded es idempotente porque ya
//     está succeeded), pero el SIDE-EFFECT en Redis (emit) sí se dispara
//     dos veces. Track: TODO-test.md webhook idempotency P0.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const stripeWebhooksMock = vi.hoisted(() => ({
  constructEvent: vi.fn((body) => JSON.parse(body)),
}))

vi.mock('../lib/env.js', () => ({
  env: { SPLITPAY_STRIPE_SECRET_KEY: 'sk_test', SPLITPAY_STRIPE_WEBHOOK_SECRET: 'whsec' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
}))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('../lib/stripe.js', () => ({
  stripe: { webhooks: stripeWebhooksMock },
  getWebhookSecret: vi.fn().mockResolvedValue('whsec'),
}))

const publishMock = vi.hoisted(() => vi.fn())
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: publishMock }))

vi.mock('../repositories/payment.repository.js')
vi.mock('../repositories/checkout-session.repository.js')
vi.mock('../services/payment.service.js', () => ({
  createAdditionalTransfers: vi.fn(),
}))
vi.mock('../services/connect-account.service.js', () => ({
  syncAccountFromStripe: vi.fn(),
}))

import { handleWebhookEvent } from '../services/webhook.service.js'
import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as paymentRepo from '../repositories/payment.repository.js'
import * as checkoutRepo from '../repositories/checkout-session.repository.js'
import { syncAccountFromStripe } from '../services/connect-account.service.js'
import { createAdditionalTransfers } from '../services/payment.service.js'

function mkClient(query = vi.fn().mockResolvedValue({ rows: [] })) {
  return { query, release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.connect.mockResolvedValue(mkClient())
})

// ── payment_intent.succeeded ─────────────────────────────────────────

describe('payment_intent.succeeded', () => {
  it('updatePaymentStatus("succeeded") + createAdditionalTransfers con latest_charge id', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', latest_charge: 'ch_1' } },
    })
    expect(paymentRepo.updatePaymentStatus).toHaveBeenCalledWith(expect.anything(), 'pi_1', 'succeeded')
    expect(createAdditionalTransfers).toHaveBeenCalledWith('pi_1', 'ch_1')
  })

  it('latest_charge como objeto (Stripe expand) → extrae .id', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', latest_charge: { id: 'ch_xyz' } } },
    })
    expect(createAdditionalTransfers).toHaveBeenCalledWith('pi_1', 'ch_xyz')
  })

  it('sin latest_charge → updateStatus pero NO createAdditionalTransfers', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    })
    expect(createAdditionalTransfers).not.toHaveBeenCalled()
  })

  it('libera el pool client en finally', async () => {
    const c = mkClient()
    pool.connect.mockResolvedValueOnce(c)
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    })
    expect(c.release).toHaveBeenCalled()
  })
})

describe('payment_intent.payment_failed / canceled', () => {
  it('payment_failed → updatePaymentStatus("failed")', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_1' } },
    })
    expect(paymentRepo.updatePaymentStatus).toHaveBeenCalledWith(expect.anything(), 'pi_1', 'failed')
  })
  it('canceled → updatePaymentStatus("canceled")', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'payment_intent.canceled',
      data: { object: { id: 'pi_1' } },
    })
    expect(paymentRepo.updatePaymentStatus).toHaveBeenCalledWith(expect.anything(), 'pi_1', 'canceled')
  })
})

// ── account.updated ──────────────────────────────────────────────────

describe('account.updated', () => {
  it('llama syncAccountFromStripe con el account id', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'account.updated',
      data: { object: { id: 'acct_xyz' } },
    })
    expect(syncAccountFromStripe).toHaveBeenCalledWith('acct_xyz')
  })

  it('error en sync se loguea pero NO propaga (no rompe el handler)', async () => {
    syncAccountFromStripe.mockRejectedValueOnce(new Error('Stripe rate limit'))
    await expect(handleWebhookEvent({
      id: 'evt_1', type: 'account.updated',
      data: { object: { id: 'acct_xyz' } },
    })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})

// ── checkout.session.completed ──────────────────────────────────────

describe('checkout.session.completed', () => {
  it('session desconocida (markCompleted=null) → warn, NO emit', async () => {
    checkoutRepo.markCompleted.mockResolvedValue(null)
    await handleWebhookEvent({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_x' } },
    })
    expect(publishMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stripeSessionId: 'cs_x' }),
      expect.stringContaining('unknown session'),
    )
  })

  it('happy: emit splitpay.checkout.completed al canal "<appId>.events"', async () => {
    checkoutRepo.markCompleted.mockResolvedValue({
      id: 'sess-uuid', stripe_session_id: 'cs_x', mode: 'payment',
      stripe_payment_intent_id: 'pi_1', amount: 5000, currency: 'eur',
      tenant_id: 't1', sub_tenant_id: null,
      metadata: { app_id: 'aikikan' },
    })
    await handleWebhookEvent({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_x', payment_intent: 'pi_1', amount_total: 5000 } },
    })
    expect(publishMock).toHaveBeenCalledWith({}, 'aikikan', {
      type: 'splitpay.checkout.completed',
      payload: expect.objectContaining({
        stripeSessionId: 'cs_x', mode: 'payment', paymentIntentId: 'pi_1',
        tenantId: 't1',
      }),
    })
  })

  it('sin app_id en metadata + no platform_subscription → SKIP emit + warn', async () => {
    checkoutRepo.markCompleted.mockResolvedValue({
      id: 'sess-uuid', stripe_session_id: 'cs_x', mode: 'payment',
      metadata: {},                                  // sin app_id
    })
    await handleWebhookEvent({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_x' } },
    })
    expect(publishMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('metadata.kind="platform_subscription" sin app_id → emit a "platform.events"', async () => {
    checkoutRepo.markCompleted.mockResolvedValue({
      id: 'sess-uuid', stripe_session_id: 'cs_x', mode: 'subscription',
      metadata: { kind: 'platform_subscription' },
    })
    await handleWebhookEvent({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_x' } },
    })
    expect(publishMock).toHaveBeenCalledWith({}, 'platform', expect.anything())
  })
})

// ── invoice.paid ────────────────────────────────────────────────────

describe('invoice.paid', () => {
  it('sin subscription → debug + no emit', async () => {
    await handleWebhookEvent({
      id: 'evt_1', type: 'invoice.paid',
      data: { object: { id: 'in_1' } },
    })
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('lookup checkout_sessions por subscription + emit con periodStart/End ISO', async () => {
    pool.connect.mockResolvedValueOnce(mkClient(vi.fn().mockResolvedValue({
      rows: [{ tenant_id: 't1', sub_tenant_id: null, metadata: { app_id: 'aikikan' } }],
    })))
    await handleWebhookEvent({
      id: 'evt_1', type: 'invoice.paid',
      data: { object: {
        id: 'in_1', subscription: 'sub_xyz', customer: 'cus_1',
        amount_paid: 5000, currency: 'eur',
        period_start: 1700000000, period_end: 1702592000,
      } },
    })
    expect(publishMock).toHaveBeenCalledWith({}, 'aikikan', {
      type: 'splitpay.invoice.paid',
      payload: expect.objectContaining({
        invoiceId: 'in_1', subscriptionId: 'sub_xyz', tenantId: 't1',
        periodStart: new Date(1700000000 * 1000).toISOString(),
        periodEnd:   new Date(1702592000 * 1000).toISOString(),
      }),
    })
  })
})

// ── subscription state changes ──────────────────────────────────────

describe('customer.subscription.updated / deleted', () => {
  it('updated → emit splitpay.subscription.updated', async () => {
    pool.connect.mockResolvedValueOnce(mkClient(vi.fn().mockResolvedValue({
      rows: [{ app_id: 'aikikan', tenant_id: 't1', metadata: { app_id: 'aikikan' } }],
    })))
    await handleWebhookEvent({
      id: 'evt_1', type: 'customer.subscription.updated',
      data: { object: {
        id: 'sub_xyz', status: 'past_due', current_period_end: 1700000000,
        cancel_at_period_end: true, metadata: { app_id: 'aikikan' },
      } },
    })
    expect(publishMock).toHaveBeenCalledWith({}, 'aikikan', {
      type: 'splitpay.subscription.updated',
      payload: expect.objectContaining({
        subscriptionId: 'sub_xyz', status: 'past_due', cancelAtPeriodEnd: true,
      }),
    })
  })

  it('deleted → emit splitpay.subscription.deleted', async () => {
    pool.connect.mockResolvedValueOnce(mkClient(vi.fn().mockResolvedValue({
      rows: [{ tenant_id: 't1', metadata: { app_id: 'aikikan' } }],
    })))
    await handleWebhookEvent({
      id: 'evt_1', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_xyz', status: 'canceled', metadata: { app_id: 'aikikan' } } },
    })
    expect(publishMock).toHaveBeenCalledWith({}, 'aikikan', expect.objectContaining({
      type: 'splitpay.subscription.deleted',
    }))
  })
})

// ── Unhandled types ─────────────────────────────────────────────────

describe('unhandled event types', () => {
  it('event type NO conocido → debug log, sin crash', async () => {
    await expect(handleWebhookEvent({
      id: 'evt_1', type: 'random.unknown.event',
      data: { object: {} },
    })).resolves.toBeUndefined()
    expect(logger.debug).toHaveBeenCalled()
  })
})

// ── Idempotencia por event.id — LÍMITE conocido ─────────────────────

describe('event.id dedup', () => {
  it.todo('replay del mismo event.id NO debe disparar emit dos veces (requiere processed_events table o Redis SETNX)')
})
