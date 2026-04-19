import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    LOG_LEVEL: 'silent',
    YOGA_USERS_PORT: 3011,
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

vi.mock('../lib/redis.js', () => ({
  redis: {}, publish: vi.fn(),
  cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDelete: vi.fn(),
}))

vi.mock('../services/event-consumer.js', () => ({ startEventConsumer: vi.fn() }))
vi.mock('../repositories/profile.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import * as profileRepo from '../repositories/profile.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const INSTRUCTOR_ID = '22222222-2222-2222-2222-222222222222'

function makeToken(overrides = {}) {
  const payload = {
    sub: USER_ID, role: 'alumno', email: 'test@yoga.com',
    tenant_id: TENANT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `Bearer x.${encoded}.y`
}

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
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

describe('GET /v1/users/me', () => {
  it('returns profile for authenticated user', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    const profile = { id: USER_ID, name: 'Ana', email: 'test@yoga.com' }
    profileRepo.findById.mockResolvedValue(profile)

    const res = await app.inject({
      method: 'GET', url: '/v1/users/me',
      headers: { authorization: makeToken() },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe('Ana')
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
    expect(client.release).toHaveBeenCalled()
  })

  it('returns 404 when profile not found', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    profileRepo.findById.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET', url: '/v1/users/me',
      headers: { authorization: makeToken() },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 when no auth header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PUT /v1/users/me', () => {
  it('updates and returns updated profile', async () => {
    const updated = { id: USER_ID, name: 'Ana Updated' }
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    profileRepo.updateProfile.mockResolvedValue(updated)

    const res = await app.inject({
      method: 'PUT', url: '/v1/users/me',
      headers: { authorization: makeToken() },
      payload: { name: 'Ana Updated' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe('Ana Updated')
  })

  it('returns 404 when profile not found during update', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    profileRepo.updateProfile.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT', url: '/v1/users/me',
      headers: { authorization: makeToken() },
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 422 on invalid payload (url field not a URL)', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/users/me',
      headers: { authorization: makeToken() },
      payload: { avatarUrl: 'not-a-url' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /v1/users/:id', () => {
  it('returns profile when called by admin', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    profileRepo.findById.mockResolvedValue({ id: INSTRUCTOR_ID, name: 'Bob' })

    const res = await app.inject({
      method: 'GET', url: `/v1/users/${INSTRUCTOR_ID}`,
      headers: { authorization: makeToken({ role: 'admin' }) },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 403 when called by alumno', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/users/${INSTRUCTOR_ID}`,
      headers: { authorization: makeToken({ role: 'alumno' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/users/:id/history', () => {
  it('returns class history for the user', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    profileRepo.getHistory.mockResolvedValue([{ booking_id: 'b1', class_name: 'Hatha' }])

    const res = await app.inject({
      method: 'GET', url: `/v1/users/${USER_ID}/history`,
      headers: { authorization: makeToken() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })
})

describe('GET /v1/users/', () => {
  it('returns search results for admin', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    profileRepo.searchProfiles.mockResolvedValue([{ id: USER_ID, name: 'Ana' }])

    const res = await app.inject({
      method: 'GET', url: '/v1/users/?search=ana',
      headers: { authorization: makeToken({ role: 'admin' }) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/users/',
      headers: { authorization: makeToken({ role: 'instructor' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})
