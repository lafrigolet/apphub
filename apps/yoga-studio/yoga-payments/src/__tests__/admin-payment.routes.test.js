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
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { stripe } from '../lib/stripe.js'
import * as txRepo from '../repositories/transaction.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const TX_ID = '88888888-8888-8888-8888-888888888888'
const SESSION_ID = 'cs_test_session_123'

function makeToken(overrides = {}) {
  const payload = {
    sub: USER_ID, role: 'admin', email: 'admin@yoga.com',
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

describe('POST /v1/admin/payments/:id/refund (admin)', () => {
  it('refunds payment and publishes payment.refunded event', async () => {
    const tx = { id: TX_ID, user_id: USER_ID, provider_tx_id: SESSION_ID, tenant_id: TENANT_ID }
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    txRepo.findByProviderTxId.mockResolvedValue(tx)

    stripe.checkout.sessions.retrieve.mockResolvedValue({ payment_intent: 'pi_test' })
    stripe.refunds.create.mockResolvedValue({ id: 're_test' })

    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    txRepo.refundTransaction.mockResolvedValue({ ...tx, status: 'refunded' })

    const res = await app.inject({
      method: 'POST', url: `/v1/admin/payments/${SESSION_ID}/refund`,
      headers: { authorization: makeToken({ role: 'admin' }) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.success).toBe(true)
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_test' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment.refunded' }))
    expect(client.release).toHaveBeenCalled()
  })

  it('returns 404 when transaction not found', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    txRepo.findByProviderTxId.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST', url: `/v1/admin/payments/unknown-session/refund`,
      headers: { authorization: makeToken({ role: 'admin' }) },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/admin/payments/${SESSION_ID}/refund`,
      headers: { authorization: makeToken({ role: 'alumno' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})
