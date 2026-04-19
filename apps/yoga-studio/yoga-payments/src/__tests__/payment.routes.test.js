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
    checkout: {
      sessions: {
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    },
    refunds: { create: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
}))

vi.mock('../repositories/transaction.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import { stripe } from '../lib/stripe.js'
import * as txRepo from '../repositories/transaction.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BONUS_TYPE_ID = '77777777-7777-7777-7777-777777777777'
const TX_ID = '88888888-8888-8888-8888-888888888888'
const SESSION_ID = 'cs_test_session_123'

function makeToken(overrides = {}) {
  const payload = {
    sub: USER_ID, role: 'alumno', email: 'test@yoga.com',
    tenant_id: TENANT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  return `Bearer x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`
}

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

describe('POST /v1/payments/checkout', () => {
  it('creates Stripe session and returns checkout URL', async () => {
    stripe.checkout.sessions.create.mockResolvedValue({
      id: SESSION_ID, url: 'https://checkout.stripe.com/pay/test',
    })
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    txRepo.createTransaction.mockResolvedValue({ id: TX_ID })

    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout',
      headers: { authorization: makeToken() },
      payload: {
        bonusTypeId: BONUS_TYPE_ID, priceEur: 80,
        successUrl: 'https://app.yoga.com/success',
        cancelUrl: 'https://app.yoga.com/cancel',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.checkoutUrl).toContain('stripe.com')
    expect(res.json().data.sessionId).toBe(SESSION_ID)
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID }),
      }),
    )
  })

  it('returns 422 on invalid payload', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout',
      headers: { authorization: makeToken() },
      payload: { bonusTypeId: 'not-uuid' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout',
      payload: { bonusTypeId: BONUS_TYPE_ID, priceEur: 80, successUrl: 'https://x.com', cancelUrl: 'https://x.com' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /v1/payments', () => {
  it('returns user transactions', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    txRepo.listByUser.mockResolvedValue([{ id: TX_ID, amount_eur: 80, status: 'completed' }])

    const res = await app.inject({
      method: 'GET', url: '/v1/payments',
      headers: { authorization: makeToken() },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
  })
})
