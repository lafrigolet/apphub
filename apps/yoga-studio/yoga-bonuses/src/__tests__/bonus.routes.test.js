import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_CRON_DATABASE_URL: 'postgres://cron@localhost/test',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    LOG_LEVEL: 'silent',
    YOGA_BONUSES_PORT: 3014,
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  cronPool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({ redis: {}, publish: vi.fn() }))
vi.mock('../services/event-consumer.js', () => ({ startEventConsumer: vi.fn() }))
vi.mock('../services/expiry-alert.service.js', () => ({ startExpiryAlerts: vi.fn() }))
vi.mock('../repositories/bonus.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import * as bonusRepo from '../repositories/bonus.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BONUS_ID = '66666666-6666-6666-6666-666666666666'
const BONUS_TYPE_ID = '77777777-7777-7777-7777-777777777777'

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

describe('GET /v1/bonuses/me', () => {
  it('returns active bonuses for authenticated user', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    bonusRepo.getActiveBonuses.mockResolvedValue([{ id: BONUS_ID, sessions_used: 2, sessions_total: 10 }])

    const res = await app.inject({
      method: 'GET', url: '/v1/bonuses/me',
      headers: { authorization: makeToken() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
    expect(client.release).toHaveBeenCalled()
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/bonuses/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /v1/admin/bonuses/types', () => {
  it('creates bonus type and returns 201', async () => {
    const bonusType = { id: BONUS_TYPE_ID, name: 'Pack 10' }
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    bonusRepo.createBonusType.mockResolvedValue(bonusType)

    const res = await app.inject({
      method: 'POST', url: '/v1/admin/bonuses/types',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { name: 'Pack 10', type: 'sessions', sessionsCount: 10, validityDays: 30, priceEur: 80 },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.name).toBe('Pack 10')
  })

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/bonuses/types',
      headers: { authorization: makeToken({ role: 'instructor' }) },
      payload: { name: 'X', type: 'sessions', validityDays: 30, priceEur: 50 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 422 on invalid type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/bonuses/types',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { name: 'X', type: 'invalid', validityDays: 30, priceEur: 50 },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /v1/admin/bonuses/assign', () => {
  it('assigns bonus to user and returns 201', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    bonusRepo.assignBonus.mockResolvedValue({ id: BONUS_ID, user_id: USER_ID })

    const res = await app.inject({
      method: 'POST', url: '/v1/admin/bonuses/assign',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { userId: USER_ID, bonusTypeId: BONUS_TYPE_ID },
    })

    expect(res.statusCode).toBe(201)
  })
})

describe('PUT /v1/bonuses/admin/:id/adjust', () => {
  it('adjusts credits and returns success', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    bonusRepo.adjustCredits.mockResolvedValue()

    const res = await app.inject({
      method: 'PUT', url: `/v1/admin/bonuses/${BONUS_ID}/adjust`,
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { delta: 5, reason: 'compensation' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.success).toBe(true)
  })
})

describe('GET /internal/bonuses/:userId/check', () => {
  it('returns hasCredits true when eligible bonus exists (no JWT needed)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    bonusRepo.getActiveBonuses.mockResolvedValue([
      { bonus_type: 'sessions', sessions_used: 2, sessions_total: 10 },
    ])

    const res = await app.inject({
      method: 'GET', url: `/internal/bonuses/${USER_ID}/check`,
      headers: { 'x-tenant-id': TENANT_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.hasCredits).toBe(true)
  })

  it('returns hasCredits false when no eligible bonus', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    bonusRepo.getActiveBonuses.mockResolvedValue([])

    const res = await app.inject({
      method: 'GET', url: `/internal/bonuses/${USER_ID}/check`,
      headers: { 'x-tenant-id': TENANT_ID },
    })

    expect(res.json().data.hasCredits).toBe(false)
  })

  it('returns 400 when X-Tenant-ID header missing', async () => {
    const res = await app.inject({
      method: 'GET', url: `/internal/bonuses/${USER_ID}/check`,
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /internal/bonuses/:userId/deduct', () => {
  it('deducts credit and returns success', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    bonusRepo.checkAndDeductCredit.mockResolvedValue({ id: BONUS_ID })

    const res = await app.inject({
      method: 'POST', url: `/internal/bonuses/${USER_ID}/deduct`,
      headers: { 'x-tenant-id': TENANT_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.success).toBe(true)
  })

  it('returns 422 when no credits available', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    bonusRepo.checkAndDeductCredit.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST', url: `/internal/bonuses/${USER_ID}/deduct`,
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('NO_CREDITS')
  })
})
