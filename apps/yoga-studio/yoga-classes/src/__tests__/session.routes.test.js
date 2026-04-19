import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_SUB_TENANT_ID: undefined,
    LOG_LEVEL: 'silent',
    YOGA_CLASSES_PORT: 3012,
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
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(), cacheDelete: vi.fn(),
}))

vi.mock('../repositories/class.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as classRepo from '../repositories/class.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const SESSION_ID = '44444444-4444-4444-4444-444444444444'

function makeToken() {
  const payload = {
    sub: USER_ID, role: 'alumno', email: 'test@yoga.com',
    tenant_id: TENANT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
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

describe('GET /v1/sessions/:id', () => {
  it('returns session for authenticated user', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    const session = { id: SESSION_ID, date: '2026-05-01', max_capacity: 12, spots_taken: 3 }
    classRepo.findSession.mockResolvedValue(session)

    const res = await app.inject({
      method: 'GET', url: `/v1/sessions/${SESSION_ID}`,
      headers: { authorization: makeToken() },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe(SESSION_ID)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
    expect(client.release).toHaveBeenCalled()
  })

  it('accepts X-Tenant-ID header for internal calls (no JWT)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    classRepo.findSession.mockResolvedValue({ id: SESSION_ID })

    const res = await app.inject({
      method: 'GET', url: `/v1/sessions/${SESSION_ID}`,
      headers: { 'x-tenant-id': TENANT_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
  })

  it('returns 401 when no auth header and no X-Tenant-ID header', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}` })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when session not found', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    classRepo.findSession.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET', url: `/v1/sessions/${SESSION_ID}`,
      headers: { authorization: makeToken() },
    })
    expect(res.statusCode).toBe(404)
  })
})
