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
  redis: {},
  publish: vi.fn(),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
}))

vi.mock('../repositories/class.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import { cacheGet, cacheSet } from '../lib/redis.js'
import * as classRepo from '../repositories/class.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const CLASS_ID = '33333333-3333-3333-3333-333333333333'
const INSTRUCTOR_ID = '22222222-2222-2222-2222-222222222222'

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
  cacheGet.mockResolvedValue(null)
})

describe('GET /v1/classes (public catalog)', () => {
  it('returns class list from DB when cache is cold', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    classRepo.listClasses.mockResolvedValue([{ id: CLASS_ID, name: 'Hatha' }])

    const res = await app.inject({ method: 'GET', url: '/v1/classes' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(cacheSet).toHaveBeenCalled()
  })

  it('returns cached data when cache is warm', async () => {
    cacheGet.mockResolvedValue([{ id: CLASS_ID, name: 'Hatha (cached)' }])

    const res = await app.inject({ method: 'GET', url: '/v1/classes' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].name).toBe('Hatha (cached)')
    expect(classRepo.listClasses).not.toHaveBeenCalled()
  })

  it('does not require authentication', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    classRepo.listClasses.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/classes' })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /v1/classes (admin only)', () => {
  const validBody = {
    name: 'Hatha Flow', type: 'hatha', instructorId: INSTRUCTOR_ID,
    room: 'Sala 1', startTime: '09:00', durationMin: 60, maxCapacity: 12,
  }

  it('creates class and returns 201', async () => {
    const created = { id: CLASS_ID, ...validBody, tenant_id: TENANT_ID }
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    classRepo.createClass.mockResolvedValue(created)

    const res = await app.inject({
      method: 'POST', url: '/v1/classes',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: validBody,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.name).toBe('Hatha Flow')
  })

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/classes',
      headers: { authorization: makeToken({ role: 'alumno' }) },
      payload: validBody,
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 422 for invalid type enum', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/classes',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { ...validBody, type: 'invalid-type' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('PUT /v1/classes/:id', () => {
  it('updates class and publishes event', async () => {
    const { publish } = await import('../lib/redis.js')
    const updated = { id: CLASS_ID, name: 'Updated Hatha', tenant_id: TENANT_ID }
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    classRepo.updateClass.mockResolvedValue(updated)

    const res = await app.inject({
      method: 'PUT', url: `/v1/classes/${CLASS_ID}`,
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { name: 'Updated Hatha' },
    })

    expect(res.statusCode).toBe(200)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'class.modified' }))
  })

  it('returns 404 when class not found', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    classRepo.updateClass.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT', url: `/v1/classes/${CLASS_ID}`,
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /v1/classes/:id', () => {
  it('deactivates class and returns 204', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    classRepo.findById.mockResolvedValue({ id: CLASS_ID })
    classRepo.deactivateClass.mockResolvedValue()

    const res = await app.inject({
      method: 'DELETE', url: `/v1/classes/${CLASS_ID}`,
      headers: { authorization: makeToken({ role: 'admin' }) },
    })
    expect(res.statusCode).toBe(204)
  })

  it('returns 404 when class not found', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    classRepo.findById.mockResolvedValue(null)

    const res = await app.inject({
      method: 'DELETE', url: `/v1/classes/${CLASS_ID}`,
      headers: { authorization: makeToken({ role: 'admin' }) },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /v1/classes/instructor/agenda', () => {
  it('returns sessions for instructor', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    classRepo.getInstructorSessions.mockResolvedValue([{ id: 's1' }])

    const res = await app.inject({
      method: 'GET', url: '/v1/classes/instructor/agenda',
      headers: { authorization: makeToken({ role: 'instructor' }) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('returns 403 for alumno', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/classes/instructor/agenda',
      headers: { authorization: makeToken({ role: 'alumno' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})
