import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_STRIPE_SECRET_KEY: 'sk_test_fake',
    YOGA_STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    LOG_LEVEL: 'silent',
    YOGA_PAYMENTS_PORT: 3015,
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({ redis: {}, publish: vi.fn() }))

vi.mock('../lib/stripe.js', () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    refunds: { create: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
}))

vi.mock('../repositories/transaction.repository.js')

import { createApp } from '../app.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { stripe } from '../lib/stripe.js'
import * as txRepo from '../repositories/transaction.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BONUS_TYPE_ID = '77777777-7777-7777-7777-777777777777'
const TX_ID = '88888888-8888-8888-8888-888888888888'
const SESSION_ID = 'cs_test_session_123'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

let app
beforeEach(async () => {
  app = createApp()
  await app.ready()
})
afterEach(async () => {
  await app.close()
  vi.clearAllMocks()
})

describe('POST /v1/webhooks/stripe', () => {
  function buildStripeEvent(type, sessionData) {
    return { type, data: { object: sessionData } }
  }

  it('handles checkout.session.completed and publishes event', async () => {
    const session = {
      id: SESSION_ID,
      payment_intent: 'pi_test',
      metadata: {
        tenantId: TENANT_ID, userId: USER_ID,
        bonusTypeId: BONUS_TYPE_ID, subTenantId: '',
      },
    }
    const stripeEvent = buildStripeEvent('checkout.session.completed', session)
    stripe.webhooks.constructEvent.mockReturnValue(stripeEvent)

    const completedTx = { id: TX_ID, amount_eur: 80 }
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    txRepo.completeTransaction.mockResolvedValue(completedTx)

    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 'valid-sig', 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'evt_test' }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().received).toBe(true)
    expect(txRepo.completeTransaction).toHaveBeenCalledWith(expect.anything(), SESSION_ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payment.completed',
      payload: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID }),
    }))
  })

  it('returns 422 when Stripe signature is invalid', async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })

    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 'bad-sig', 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(res.statusCode).toBe(422)
    expect(publish).not.toHaveBeenCalled()
  })

  it('returns 200 without publishing when tenantId missing in metadata', async () => {
    const session = {
      id: SESSION_ID,
      metadata: { userId: USER_ID, bonusTypeId: BONUS_TYPE_ID, tenantId: '' },
    }
    stripe.webhooks.constructEvent.mockReturnValue(buildStripeEvent('checkout.session.completed', session))

    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(res.statusCode).toBe(200)
    expect(publish).not.toHaveBeenCalled()
  })

  it('handles checkout.session.expired gracefully', async () => {
    stripe.webhooks.constructEvent.mockReturnValue(buildStripeEvent('checkout.session.expired', { id: SESSION_ID }))

    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(res.statusCode).toBe(200)
    expect(txRepo.completeTransaction).not.toHaveBeenCalled()
  })
})
