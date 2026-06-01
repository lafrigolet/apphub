import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withStaffBypass: vi.fn(async (fn) => fn(stubClient)),
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn() }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: publishSpy }))

vi.mock('../repositories/donations.repository.js', () => ({
  findById:        vi.fn(),
  findBySessionId: vi.fn(),
  markPaid:        vi.fn(),
  insert:          vi.fn(),
}))
vi.mock('../repositories/donation-subscriptions.repository.js', () => ({
  findByStripeId:  vi.fn(),
  upsertByStripeId: vi.fn(),
  markCancelled:   vi.fn(),
}))
vi.mock('../repositories/causes.repository.js', () => ({
  incrementRaised: vi.fn(),
}))

import { startSplitpayEventsHandler } from '../services/splitpay-events.handler.js'
import * as donRepo    from '../repositories/donations.repository.js'
import * as subsRepo   from '../repositories/donation-subscriptions.repository.js'
import * as causesRepo from '../repositories/causes.repository.js'

// Fake Redis client. The handler calls duplicate() → psubscribe() and
// listens on 'pmessage'. We capture the listener so tests can fire events.
function makeFakeRedis() {
  const dup = {
    on: vi.fn(),
    psubscribe: vi.fn((_pat, cb) => cb && cb(null)),
    listeners: {},
  }
  dup.on.mockImplementation((evt, cb) => { dup.listeners[evt] = cb })
  return {
    duplicate: vi.fn().mockReturnValue(dup),
    _dup: dup,
  }
}

async function fire(handler, event) {
  const fakeRedis = makeFakeRedis()
  startSplitpayEventsHandler({ redis: fakeRedis })
  const pmessage = fakeRedis._dup.listeners['pmessage']
  await pmessage('*.events', 'aikikan.events', JSON.stringify(event))
}

beforeEach(() => vi.clearAllMocks())

// ── Filtro por purpose ──────────────────────────────────────────────────

describe('filtro por metadata.purpose === "donation"', () => {
  it('ignora eventos NO splitpay.*', async () => {
    await fire(null, { type: 'app.user.created', payload: { metadata: { purpose: 'donation' } } })
    expect(donRepo.findById).not.toHaveBeenCalled()
  })

  it('ignora splitpay.* sin metadata.purpose=donation (e.g. compra orders)', async () => {
    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: { metadata: { purpose: 'order' }, paymentIntentId: 'pi_x' },
    })
    expect(donRepo.findById).not.toHaveBeenCalled()
  })

  it('splitpay.* sin payload → metadata default {} → purpose distinto de donation → ignora', async () => {
    await fire(null, { type: 'splitpay.checkout.completed' })   // sin payload → `payload?.metadata ?? {}`
    expect(donRepo.findById).not.toHaveBeenCalled()
  })

  it('procesa splitpay.checkout.completed cuando purpose=donation', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', sub_tenant_id: null,
      cause_id: null, donor_email: 'd@x', donor_name: 'Test',
      amount_cents: 2500, currency: 'EUR', kind: 'one_shot',
    })
    donRepo.markPaid.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1',
      donor_email: 'd@x', donor_name: 'Test', amount_cents: 2500,
      currency: 'EUR', cause_id: null, kind: 'one_shot',
    })

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: {
        metadata: { purpose: 'donation', donation_id: 'd1' },
        mode: 'payment', paymentIntentId: 'pi_test',
      },
    })

    expect(donRepo.markPaid).toHaveBeenCalledWith(stubClient, 'd1', {
      paymentIntentId: 'pi_test',
      paidAt: expect.any(Date),
    })
  })
})

// ── checkout.completed ──────────────────────────────────────────────────

describe('splitpay.checkout.completed', () => {
  it('lookup por metadata.donation_id; ignora si no se encuentra', async () => {
    donRepo.findById.mockResolvedValue(null)
    donRepo.findBySessionId.mockResolvedValue(null)

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: { metadata: { purpose: 'donation', donation_id: 'unknown' } },
    })

    expect(donRepo.markPaid).not.toHaveBeenCalled()
  })

  it('fallback a stripeSessionId si el donation_id no resuelve', async () => {
    donRepo.findById.mockResolvedValue(null)
    donRepo.findBySessionId.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', cause_id: null,
      donor_email: 'x@x', donor_name: 'X', amount_cents: 1000,
      currency: 'EUR', kind: 'one_shot',
    })
    donRepo.markPaid.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1',
      donor_email: 'x@x', donor_name: 'X', amount_cents: 1000,
      currency: 'EUR', cause_id: null, kind: 'one_shot',
    })

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: {
        metadata: { purpose: 'donation' },   // sin donation_id
        stripeSessionId: 'cs_test_xyz',
      },
    })

    expect(donRepo.findBySessionId).toHaveBeenCalledWith(stubClient, 'cs_test_xyz')
    expect(donRepo.markPaid).toHaveBeenCalled()
  })

  it('incrementa raised_cents cuando la donación tiene cause_id', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', cause_id: 'c1',
      donor_email: 'x@x', donor_name: 'X', amount_cents: 5000,
      currency: 'EUR', kind: 'one_shot',
    })
    donRepo.markPaid.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1',
      donor_email: 'x@x', donor_name: 'X', amount_cents: 5000,
      currency: 'EUR', cause_id: 'c1', kind: 'one_shot',
    })

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: { metadata: { purpose: 'donation', donation_id: 'd1' }, mode: 'payment' },
    })

    expect(causesRepo.incrementRaised).toHaveBeenCalledWith(stubClient, 'c1', 5000)
  })

  it('publica donation.completed con el payload esperado', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', cause_id: 'c1',
      donor_email: 'd@x', donor_name: 'Test', amount_cents: 2500,
      currency: 'EUR', kind: 'one_shot',
    })
    donRepo.markPaid.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1',
      donor_email: 'd@x', donor_name: 'Test', amount_cents: 2500,
      currency: 'EUR', cause_id: 'c1', kind: 'one_shot',
    })

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: { metadata: { purpose: 'donation', donation_id: 'd1' }, mode: 'payment' },
    })

    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(),
      'aikikan',
      expect.objectContaining({
        type: 'donation.completed',
        payload: expect.objectContaining({
          donationId: 'd1', donorEmail: 'd@x', amountCents: 2500,
        }),
      }),
    )
  })
})

describe('checkout.completed — mode subscription', () => {
  it('upsertea la suscripción y enlaza subscription_id en la donación', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', sub_tenant_id: null, cause_id: 'c1',
      donor_user_id: 'u1', donor_email: 'd@x', donor_name: 'Test', donor_nif: 'X1',
      amount_cents: 2500, currency: 'EUR', kind: 'recurring_monthly',
    })
    subsRepo.upsertByStripeId.mockResolvedValue({ id: 'sub1' })
    donRepo.markPaid.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', donor_email: 'd@x',
      donor_name: 'Test', amount_cents: 2500, currency: 'EUR', cause_id: 'c1', kind: 'recurring_monthly',
    })
    stubClient.query.mockResolvedValue({ rows: [] })

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: {
        metadata: { purpose: 'donation', donation_id: 'd1' },
        mode: 'subscription', subscriptionId: 'sub_stripe_1', customerId: 'cus_1',
        paymentIntentId: 'pi_x',
      },
    })

    expect(subsRepo.upsertByStripeId).toHaveBeenCalledWith(stubClient, expect.objectContaining({
      stripeSubscriptionId: 'sub_stripe_1', stripeCustomerId: 'cus_1', status: 'active',
    }))
    expect(stubClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET subscription_id = \$2/), ['d1', 'sub1'],
    )
  })

  it('markPaid devuelve null → no publica donation.completed', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd1', app_id: 'aikikan', tenant_id: 't1', cause_id: null,
      donor_email: 'd@x', donor_name: 'T', amount_cents: 100, currency: 'EUR', kind: 'one_shot',
    })
    donRepo.markPaid.mockResolvedValue(null)

    await fire(null, {
      type: 'splitpay.checkout.completed',
      payload: { metadata: { purpose: 'donation', donation_id: 'd1' }, mode: 'payment' },
    })
    expect(causesRepo.incrementRaised).not.toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })
})

describe('splitpay.invoice.paid — renovaciones', () => {
  it('sin subscriptionId → no hace nada', async () => {
    await fire(null, {
      type: 'splitpay.invoice.paid',
      payload: { metadata: { purpose: 'donation' } },
    })
    expect(subsRepo.findByStripeId).not.toHaveBeenCalled()
  })

  it('suscripción desconocida → ignora', async () => {
    subsRepo.findByStripeId.mockResolvedValue(null)
    await fire(null, {
      type: 'splitpay.invoice.paid',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(donRepo.insert).not.toHaveBeenCalled()
  })

  it('primer cobro reciente (<300s) → NO duplica donación', async () => {
    subsRepo.findByStripeId.mockResolvedValue({ id: 'sub1', app_id: 'aikikan', tenant_id: 't1', amount_cents: 1000, currency: 'EUR' })
    stubClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'd_prev' }] })  // existing paid
      .mockResolvedValueOnce({ rows: [{ sec: 120 }] })        // hace 120s
    await fire(null, {
      type: 'splitpay.invoice.paid',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(donRepo.insert).not.toHaveBeenCalled()
  })

  it('renovación real → INSERT nueva donación paid + incrementRaised + publish', async () => {
    subsRepo.findByStripeId.mockResolvedValue({
      id: 'sub1', app_id: 'aikikan', tenant_id: 't1', sub_tenant_id: null, cause_id: 'c1',
      donor_user_id: 'u1', donor_email: 'd@x', donor_name: 'T', donor_nif: 'X1',
      amount_cents: 1000, currency: 'EUR',
    })
    // No existing paid donation → renovación.
    stubClient.query.mockResolvedValue({ rows: [] })
    donRepo.insert.mockResolvedValue({ id: 'd_new', amount_cents: 2000 })

    await fire(null, {
      type: 'splitpay.invoice.paid',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x', amount: 2000, paymentIntentId: 'pi_r' },
    })

    expect(donRepo.insert).toHaveBeenCalledWith(stubClient, expect.objectContaining({
      status: 'paid', kind: 'recurring_monthly', amountCents: 2000,
    }))
    expect(causesRepo.incrementRaised).toHaveBeenCalledWith(stubClient, 'c1', 2000)
    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(), 'aikikan',
      expect.objectContaining({ type: 'donation.recurring.charged' }),
    )
  })

  it('renovación sin cause_id → no incrementa raised', async () => {
    subsRepo.findByStripeId.mockResolvedValue({
      id: 'sub1', app_id: 'aikikan', tenant_id: 't1', cause_id: null,
      donor_email: 'd@x', donor_name: 'T', amount_cents: 1000, currency: 'EUR',
    })
    stubClient.query.mockResolvedValue({ rows: [] })
    donRepo.insert.mockResolvedValue({ id: 'd_new', amount_cents: 1000 })
    await fire(null, {
      type: 'splitpay.invoice.paid',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(causesRepo.incrementRaised).not.toHaveBeenCalled()
  })
})

describe('splitpay.invoice.payment_failed', () => {
  it('sin subscriptionId → no hace nada', async () => {
    await fire(null, {
      type: 'splitpay.invoice.payment_failed',
      payload: { metadata: { purpose: 'donation' } },
    })
    expect(subsRepo.findByStripeId).not.toHaveBeenCalled()
  })

  it('suscripción desconocida → ignora', async () => {
    subsRepo.findByStripeId.mockResolvedValue(null)
    await fire(null, {
      type: 'splitpay.invoice.payment_failed',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('marca past_due y publica donation.recurring.failed', async () => {
    subsRepo.findByStripeId.mockResolvedValue({
      id: 'sub1', app_id: 'aikikan', tenant_id: 't1', donor_email: 'd@x', donor_name: 'T',
    })
    stubClient.query.mockResolvedValue({ rows: [] })
    await fire(null, {
      type: 'splitpay.invoice.payment_failed',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(stubClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET status = 'past_due'/), ['sub1'],
    )
    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(), 'aikikan',
      expect.objectContaining({ type: 'donation.recurring.failed' }),
    )
  })
})

describe('splitpay.subscription.updated', () => {
  it('sin subscriptionId → no hace nada', async () => {
    await fire(null, {
      type: 'splitpay.subscription.updated',
      payload: { metadata: { purpose: 'donation' } },
    })
    expect(subsRepo.findByStripeId).not.toHaveBeenCalled()
  })

  it('suscripción desconocida → ignora', async () => {
    subsRepo.findByStripeId.mockResolvedValue(null)
    await fire(null, {
      type: 'splitpay.subscription.updated',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(stubClient.query).not.toHaveBeenCalled()
  })

  it('actualiza status/period/cancel con COALESCE', async () => {
    subsRepo.findByStripeId.mockResolvedValue({ id: 'sub1', app_id: 'aikikan', tenant_id: 't1' })
    stubClient.query.mockResolvedValue({ rows: [] })
    await fire(null, {
      type: 'splitpay.subscription.updated',
      payload: {
        metadata: { purpose: 'donation' }, subscriptionId: 'sub_x',
        status: 'active', currentPeriodEnd: '2026-02-01', cancelAtPeriodEnd: true,
      },
    })
    expect(stubClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/cancel_at_period_end = COALESCE\(\$4/),
      ['sub1', 'active', '2026-02-01', true],
    )
  })

  it('sin status/period/cancel → params null (ramas `?? null`)', async () => {
    subsRepo.findByStripeId.mockResolvedValue({ id: 'sub2', app_id: 'aikikan', tenant_id: 't1' })
    stubClient.query.mockResolvedValue({ rows: [] })
    await fire(null, {
      type: 'splitpay.subscription.updated',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_y' },
    })
    expect(stubClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/cancel_at_period_end = COALESCE\(\$4/),
      ['sub2', null, null, null],
    )
  })
})

describe('subscription.deleted — guards', () => {
  it('sin subscriptionId → no hace nada', async () => {
    await fire(null, {
      type: 'splitpay.subscription.deleted',
      payload: { metadata: { purpose: 'donation' } },
    })
    expect(subsRepo.findByStripeId).not.toHaveBeenCalled()
  })
  it('suscripción desconocida → ignora', async () => {
    subsRepo.findByStripeId.mockResolvedValue(null)
    await fire(null, {
      type: 'splitpay.subscription.deleted',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_x' },
    })
    expect(subsRepo.markCancelled).not.toHaveBeenCalled()
  })
})

describe('robustez del subscriber', () => {
  it('mensaje no-JSON → se ignora silenciosamente', async () => {
    const fakeRedis = makeFakeRedis()
    startSplitpayEventsHandler({ redis: fakeRedis })
    const pmessage = fakeRedis._dup.listeners['pmessage']
    await expect(pmessage('*.events', 'ch', 'not-json{')).resolves.toBeUndefined()
    expect(donRepo.findById).not.toHaveBeenCalled()
  })

  it('tipo splitpay.* desconocido (default) → noop sin crash', async () => {
    await fire(null, {
      type: 'splitpay.something.else',
      payload: { metadata: { purpose: 'donation' } },
    })
    expect(donRepo.findById).not.toHaveBeenCalled()
  })

  it('handler que lanza → capturado y logueado (no propaga)', async () => {
    donRepo.findById.mockRejectedValue(new Error('boom'))
    await expect(fire(null, {
      type: 'splitpay.checkout.completed',
      payload: { metadata: { purpose: 'donation', donation_id: 'd1' } },
    })).resolves.toBeUndefined()
  })

  it('psubscribe con error → loguea y no registra pmessage handler', async () => {
    const dup = {
      on: vi.fn(),
      psubscribe: vi.fn((_pat, cb) => cb(new Error('subfail'))),
      listeners: {},
    }
    dup.on.mockImplementation((evt, cb) => { dup.listeners[evt] = cb })
    const fakeRedis = { duplicate: vi.fn().mockReturnValue(dup) }
    const sub = startSplitpayEventsHandler({ redis: fakeRedis })
    expect(sub).toBe(dup)
  })

  it('error listener del sub se registra', () => {
    const fakeRedis = makeFakeRedis()
    startSplitpayEventsHandler({ redis: fakeRedis })
    // dispara el handler de error para cubrir la callback
    fakeRedis._dup.listeners['error']?.(new Error('redis down'))
    expect(fakeRedis._dup.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})

// ── subscription lifecycle ──────────────────────────────────────────────

describe('splitpay.subscription.deleted', () => {
  it('publica donation.recurring.cancelled', async () => {
    subsRepo.findByStripeId.mockResolvedValue({
      id: 'sub1', app_id: 'aikikan', tenant_id: 't1',
      donor_email: 'd@x', donor_name: 'Test',
    })

    await fire(null, {
      type: 'splitpay.subscription.deleted',
      payload: { metadata: { purpose: 'donation' }, subscriptionId: 'sub_stripe_1' },
    })

    expect(subsRepo.markCancelled).toHaveBeenCalledWith(stubClient, 'sub1')
    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(),
      'aikikan',
      expect.objectContaining({ type: 'donation.recurring.cancelled' }),
    )
  })
})
