import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'

// Mock all infrastructure before importing the app
vi.mock('../../src/lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PAYMENTS_PORT: 3001,
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    PAYMENTS_STRIPE_SECRET_KEY: 'sk_test_mock',
    PAYMENTS_STRIPE_WEBHOOK_SECRET: 'whsec_test_mock',
    PAYMENTS_STRIPE_PUBLISHABLE_KEY: 'pk_test_mock',
    JWT_SECRET: 'test_secret_at_least_32_chars_long_here',
    LOG_LEVEL: 'error',
  },
}))

vi.mock('../../src/lib/db.js', () => ({
  pool: { connect: vi.fn(), end: vi.fn() },
  withTenant: vi.fn(),
}))

vi.mock('../../src/lib/redis.js', () => ({
  redis: { quit: vi.fn() },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDelete: vi.fn().mockResolvedValue(undefined),
  checkIdempotency: vi.fn().mockResolvedValue(null),
  storeIdempotency: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    accounts: { create: vi.fn(), retrieve: vi.fn() },
    accountLinks: { create: vi.fn() },
    refunds: { create: vi.fn() },
    transfers: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
}))

vi.mock('../../src/repositories/split-rule.repository.js', () => ({
  createSplitRule: vi.fn(),
  findSplitRuleById: vi.fn(),
  listSplitRules: vi.fn(),
  deactivateSplitRule: vi.fn(),
}))

vi.mock('../../src/repositories/payment.repository.js', () => ({
  insertPayment: vi.fn(),
  findPaymentById: vi.fn(),
  findPaymentByStripeId: vi.fn(),
  updatePaymentStatus: vi.fn(),
  listPayments: vi.fn(),
}))

vi.mock('../../src/repositories/connect-account.repository.js', () => ({
  insertConnectAccount: vi.fn(),
  findConnectAccountById: vi.fn(),
  findConnectAccountByStripeId: vi.fn(),
  listConnectAccounts: vi.fn(),
  updateConnectAccountStatus: vi.fn(),
}))

import { createApp } from '../../src/app.js'
import * as splitRuleRepo from '../../src/repositories/split-rule.repository.js'
import * as paymentRepo from '../../src/repositories/payment.repository.js'
import * as db from '../../src/lib/db.js'
import { stripe } from '../../src/lib/stripe.js'

// Helper: create a valid JWT-like token with tenant claims
function makeToken(tenantId, subTenantId = null) {
  const payload = Buffer.from(
    JSON.stringify({ tenant_id: tenantId, sub_tenant_id: subTenantId, exp: 9999999999 }),
  ).toString('base64url')
  return `Bearer header.${payload}.sig`
}

const mockSplitRule = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-abc',
  subTenantId: null,
  name: 'Test Rule',
  platformFeePercent: 15,
  recipients: [{ accountId: 'acct_merchant', label: 'Merchant', percentage: 85 }],
  active: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

const mockPayment = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  tenantId: 'tenant-abc',
  subTenantId: null,
  stripePaymentIntentId: 'pi_test_123',
  amount: 10000,
  currency: 'eur',
  status: 'requires_payment_method',
  splitRuleId: '550e8400-e29b-41d4-a716-446655440000',
  merchantAccountId: 'acct_merchant',
  platformFee: 1500,
  metadata: {},
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

let app

beforeAll(async () => {
  app = createApp()
  await app.ready()
})

// ── Health check ───────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with service info', async () => {
    const res = await request(app.server).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', service: 'split-payments' })
  })
})

// ── 404 handler ────────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await request(app.server).get('/v1/unknown-route')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

// ── Auth guard ─────────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app.server).get('/v1/split-rules')
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(app.server)
      .get('/v1/split-rules')
      .set('Authorization', 'Bearer not.a.valid.token')
    expect(res.status).toBe(401)
  })
})

// ── Split rules ────────────────────────────────────────────────────────────

describe('GET /v1/split-rules', () => {
  it('returns list of split rules', async () => {
    const mockClient = { release: vi.fn() }
    vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
    vi.mocked(splitRuleRepo.listSplitRules).mockResolvedValue([mockSplitRule])

    const res = await request(app.server)
      .get('/v1/split-rules')
      .set('Authorization', makeToken('tenant-abc'))

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})

describe('POST /v1/split-rules', () => {
  it('creates a split rule and returns 201', async () => {
    vi.mocked(db.withTenant).mockImplementation(async (_tid, _stid, fn) => fn({}))
    vi.mocked(splitRuleRepo.createSplitRule).mockResolvedValue(mockSplitRule)

    const body = {
      name: 'Test Rule',
      platformFeePercent: 15,
      recipients: [{ accountId: 'acct_merchant', label: 'Merchant', percentage: 85 }],
    }

    const res = await request(app.server)
      .post('/v1/split-rules')
      .set('Authorization', makeToken('tenant-abc'))
      .send(body)

    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Test Rule')
  })

  it('returns 422 when percentages do not sum to 100', async () => {
    const body = {
      name: 'Bad Rule',
      platformFeePercent: 15,
      recipients: [{ accountId: 'acct_merchant', label: 'Merchant', percentage: 50 }],
      // 15 + 50 = 65, not 100
    }

    const res = await request(app.server)
      .post('/v1/split-rules')
      .set('Authorization', makeToken('tenant-abc'))
      .send(body)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /v1/split-rules/simulate', () => {
  it('returns split simulation', async () => {
    vi.mocked(db.pool.connect).mockResolvedValue({ release: vi.fn() })
    vi.mocked(splitRuleRepo.findSplitRuleById).mockResolvedValue(mockSplitRule)

    const res = await request(app.server)
      .post('/v1/split-rules/simulate')
      .set('Authorization', makeToken('tenant-abc'))
      .send({ splitRuleId: '550e8400-e29b-41d4-a716-446655440000', amount: 10000, currency: 'eur' })

    expect(res.status).toBe(200)
    expect(res.body.data.grossAmount).toBe(10000)
    expect(res.body.data.stripeFee).toBeGreaterThan(0)
    expect(res.body.data.recipients).toHaveLength(1)
  })
})

// ── Payments ───────────────────────────────────────────────────────────────

describe('POST /v1/payments', () => {
  it('creates a payment intent and returns 201', async () => {
    const mockClient = { release: vi.fn() }
    vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
    vi.mocked(splitRuleRepo.findSplitRuleById).mockResolvedValue(mockSplitRule)
    vi.mocked(paymentRepo.insertPayment).mockResolvedValue(mockPayment)
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret',
      status: 'requires_payment_method',
    })

    const body = {
      amount: 10000,
      currency: 'eur',
      splitRuleId: '550e8400-e29b-41d4-a716-446655440000',
      merchantAccountId: 'acct_merchant',
      idempotencyKey: 'test-key-001',
    }

    const res = await request(app.server)
      .post('/v1/payments')
      .set('Authorization', makeToken('tenant-abc'))
      .send(body)

    expect(res.status).toBe(201)
    expect(res.body.data.clientSecret).toBe('pi_test_123_secret')
    expect(res.body.data.paymentId).toBe('550e8400-e29b-41d4-a716-446655440001')
  })

  it('returns 422 for invalid amount', async () => {
    const res = await request(app.server)
      .post('/v1/payments')
      .set('Authorization', makeToken('tenant-abc'))
      .send({
        amount: -100,
        currency: 'eur',
        splitRuleId: '550e8400-e29b-41d4-a716-446655440000',
        merchantAccountId: 'acct_merchant',
        idempotencyKey: 'key-002',
      })

    expect(res.status).toBe(422)
  })
})

describe('GET /v1/payments', () => {
  it('returns paginated payment list', async () => {
    const mockClient = { release: vi.fn() }
    vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
    vi.mocked(paymentRepo.listPayments).mockResolvedValue([mockPayment])

    const res = await request(app.server)
      .get('/v1/payments')
      .set('Authorization', makeToken('tenant-abc'))

    expect(res.status).toBe(200)
    expect(res.body.data.data).toHaveLength(1)
    expect(res.body.data.hasMore).toBe(false)
  })
})
