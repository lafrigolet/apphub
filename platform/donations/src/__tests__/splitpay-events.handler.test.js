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
