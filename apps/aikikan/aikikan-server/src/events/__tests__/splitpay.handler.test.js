// Subscriber a aikikan.events: eventos splitpay.* desde platform-core.
// Contrato:
//   - Suscribe a CHANNEL = 'aikikan.events'.
//   - Solo procesa eventos cuyo type empieza por 'splitpay.'; ignora otros y JSON malformado.
//   - splitpay.checkout.completed:
//       · Requiere tenantId + metadata.user_id + stripeSessionId.
//       · markPaymentPaid → fee_payments row paid.
//       · Si mode='subscription' + subscriptionId: upsertSubscription(status='active').
//   - splitpay.invoice.paid:
//       · Lookup por subscriptionId; si no existe → ignora (race con checkout.completed inicial).
//       · Si existe → insertSubscriptionPayment + upsertSubscription(currentPeriodEnd).
//   - splitpay.subscription.{updated,deleted}: upsertSubscription con nuevo status, cancel_at_period_end.
//   - splitpay.invoice.payment_failed: solo logger.warn (no DB).
//   - Excepción en handler NO crashea el subscriber.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisSubscribeMock, redisConnectMock, redisOnMock, capturedHandlers } = vi.hoisted(() => {
  const handlers = {}
  return {
    capturedHandlers: handlers,
    redisConnectMock:   vi.fn().mockResolvedValue(undefined),
    redisSubscribeMock: vi.fn((_chan, cb) => cb && cb(null)),
    redisOnMock:        vi.fn((evt, h) => { handlers[evt] = h }),
  }
})

vi.mock('../../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../lib/db.js', () => ({
  pool: {},
  withTenantTransaction: vi.fn(async (_p, _a, _t, _s, fn) => fn({ query: vi.fn() })),
}))
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: redisConnectMock,
    on: redisOnMock,
    subscribe: redisSubscribeMock,
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('../../repositories/fees.repository.js')

import { startSplitpayEventSubscriber } from '../splitpay.handler.js'
import * as repo from '../../repositories/fees.repository.js'
import { logger } from '../../lib/logger.js'

const TENANT  = '00000000-0000-0000-0000-000000000001'
const USER    = '11111111-1111-1111-1111-111111111111'
const SESSION = 'cs_test_abc123'

async function emit(event) {
  startSplitpayEventSubscriber()
  await capturedHandlers.message('aikikan.events', JSON.stringify(event))
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(capturedHandlers)) delete capturedHandlers[k]
})

// ── Subscription setup ───────────────────────────────────────────────

describe('subscribe', () => {
  it('se conecta y suscribe a "aikikan.events"', () => {
    startSplitpayEventSubscriber()
    expect(redisConnectMock).toHaveBeenCalled()
    expect(redisSubscribeMock).toHaveBeenCalledWith('aikikan.events', expect.any(Function))
    expect(redisOnMock).toHaveBeenCalledWith('message', expect.any(Function))
  })
})

// ── Filtering ────────────────────────────────────────────────────────

describe('event filter', () => {
  it('ignora JSON malformado sin crashear', async () => {
    startSplitpayEventSubscriber()
    await expect(capturedHandlers.message('aikikan.events', '{not json')).resolves.toBeUndefined()
    expect(repo.markPaymentPaid).not.toHaveBeenCalled()
  })

  it('ignora eventos cuyo type NO empieza por "splitpay."', async () => {
    await emit({ type: 'user.revoked', payload: { tenantId: TENANT } })
    expect(repo.markPaymentPaid).not.toHaveBeenCalled()
  })

  it('ignora eventos sin type', async () => {
    await emit({ payload: { foo: 1 } })
    expect(repo.markPaymentPaid).not.toHaveBeenCalled()
  })
})

// ── splitpay.checkout.completed ──────────────────────────────────────

describe('splitpay.checkout.completed', () => {
  it('payload incompleto (sin user_id) → warn + no DB', async () => {
    await emit({
      type: 'splitpay.checkout.completed',
      payload: { tenantId: TENANT, stripeSessionId: SESSION, metadata: {} },
    })
    expect(repo.markPaymentPaid).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(), expect.stringContaining('incomplete'),
    )
  })

  it('happy one-shot: markPaymentPaid pero NO upsertSubscription', async () => {
    repo.markPaymentPaid.mockResolvedValue({ id: 'pay-1' })
    await emit({
      type: 'splitpay.checkout.completed',
      payload: {
        tenantId: TENANT, stripeSessionId: SESSION,
        paymentIntentId: 'pi_123',
        metadata: { user_id: USER },
        mode: 'payment',
      },
    })
    expect(repo.markPaymentPaid).toHaveBeenCalledWith(expect.anything(), SESSION, 'pi_123', null)
    expect(repo.upsertSubscription).not.toHaveBeenCalled()
  })

  it('happy subscription: markPaymentPaid + upsertSubscription(active)', async () => {
    repo.markPaymentPaid.mockResolvedValue({ id: 'pay-1' })
    await emit({
      type: 'splitpay.checkout.completed',
      payload: {
        tenantId: TENANT, stripeSessionId: SESSION,
        metadata: { user_id: USER },
        mode: 'subscription',
        subscriptionId: 'sub_xyz',
        customerId: 'cus_abc',
      },
    })
    expect(repo.markPaymentPaid).toHaveBeenCalled()
    expect(repo.upsertSubscription).toHaveBeenCalledWith(expect.anything(), {
      appId: 'aikikan', tenantId: TENANT, subTenantId: null, userId: USER,
      status: 'active', stripeSubscriptionId: 'sub_xyz', stripeCustomerId: 'cus_abc',
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    })
  })
})

// ── splitpay.invoice.paid ────────────────────────────────────────────

describe('splitpay.invoice.paid', () => {
  it('ignora si payload sin subscriptionId/tenantId', async () => {
    await emit({ type: 'splitpay.invoice.paid', payload: { invoiceId: 'in_1' } })
    expect(repo.findSubscriptionByStripeId).not.toHaveBeenCalled()
  })

  it('subscription desconocida → debug + no insert', async () => {
    repo.findSubscriptionByStripeId.mockResolvedValue(null)
    await emit({
      type: 'splitpay.invoice.paid',
      payload: { tenantId: TENANT, subscriptionId: 'sub_unknown', invoiceId: 'in_1' },
    })
    expect(repo.insertSubscriptionPayment).not.toHaveBeenCalled()
  })

  it('subscription conocida → insertSubscriptionPayment + upsert con periodEnd', async () => {
    repo.findSubscriptionByStripeId.mockResolvedValue({
      app_id: 'aikikan', tenant_id: TENANT, sub_tenant_id: null,
      user_id: USER, stripe_customer_id: 'cus_abc', cancel_at_period_end: false,
    })
    await emit({
      type: 'splitpay.invoice.paid',
      payload: {
        tenantId: TENANT, subscriptionId: 'sub_xyz', invoiceId: 'in_42',
        amount: 5000, currency: 'EUR', periodEnd: '2027-05-22T00:00:00Z',
      },
    })
    expect(repo.insertSubscriptionPayment).toHaveBeenCalledWith(expect.anything(), {
      appId: 'aikikan', tenantId: TENANT, subTenantId: null, userId: USER,
      productCodes: ['anual'], amountCents: 5000, currency: 'EUR', stripeInvoiceId: 'in_42',
    })
    expect(repo.upsertSubscription).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: 'active', stripeSubscriptionId: 'sub_xyz',
      currentPeriodEnd: new Date('2027-05-22T00:00:00Z'),
    }))
  })
})

// ── splitpay.subscription.updated / .deleted ─────────────────────────

describe('splitpay.subscription.* state change', () => {
  it('subscription.updated cambia status + cancel_at_period_end', async () => {
    repo.findSubscriptionByStripeId.mockResolvedValue({
      app_id: 'aikikan', tenant_id: TENANT, sub_tenant_id: null,
      user_id: USER, stripe_customer_id: 'cus_abc', current_period_end: null,
    })
    await emit({
      type: 'splitpay.subscription.updated',
      payload: {
        tenantId: TENANT, subscriptionId: 'sub_xyz',
        status: 'past_due', cancelAtPeriodEnd: true,
      },
    })
    expect(repo.upsertSubscription).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: 'past_due', cancelAtPeriodEnd: true,
    }))
  })

  it('subscription.deleted con status="canceled" del payload', async () => {
    repo.findSubscriptionByStripeId.mockResolvedValue({
      app_id: 'aikikan', tenant_id: TENANT, sub_tenant_id: null,
      user_id: USER, stripe_customer_id: 'c', current_period_end: null,
    })
    await emit({
      type: 'splitpay.subscription.deleted',
      payload: { tenantId: TENANT, subscriptionId: 'sub_xyz', status: 'canceled' },
    })
    expect(repo.upsertSubscription).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ status: 'canceled' }),
    )
  })

  it('subscription desconocida → no upsert', async () => {
    repo.findSubscriptionByStripeId.mockResolvedValue(null)
    await emit({
      type: 'splitpay.subscription.updated',
      payload: { tenantId: TENANT, subscriptionId: 'ghost', status: 'active' },
    })
    expect(repo.upsertSubscription).not.toHaveBeenCalled()
  })
})

// ── splitpay.invoice.payment_failed ──────────────────────────────────

describe('splitpay.invoice.payment_failed', () => {
  it('solo loguea warn, sin tocar DB', async () => {
    await emit({
      type: 'splitpay.invoice.payment_failed',
      payload: { subscriptionId: 'sub_xyz', tenantId: TENANT },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub_xyz' }),
      expect.stringContaining('payment failed'),
    )
    expect(repo.upsertSubscription).not.toHaveBeenCalled()
  })
})

// ── Resilience ───────────────────────────────────────────────────────

describe('resilience', () => {
  it('excepción dentro de handler → loguea error, no crashea subscriber', async () => {
    repo.markPaymentPaid.mockRejectedValue(new Error('DB down'))
    await expect(emit({
      type: 'splitpay.checkout.completed',
      payload: { tenantId: TENANT, stripeSessionId: SESSION, metadata: { user_id: USER } },
    })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
