import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    LOG_LEVEL: 'silent',
    YOGA_REPORTING_PORT: 3017,
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
vi.mock('../services/event-consumer.js', () => ({ startEventConsumer: vi.fn() }))
vi.mock('../repositories/reporting.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as reportRepo from '../repositories/reporting.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

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

describe('GET /v1/reports/dashboard', () => {
  it('returns metrics for admin', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    const metrics = { total_bookings: 100, total_attended: 90 }
    reportRepo.getDashboard.mockResolvedValue(metrics)

    const res = await app.inject({
      method: 'GET', url: '/v1/reports/dashboard',
      headers: { authorization: makeToken({ role: 'admin' }) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.total_bookings).toBe(100)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
    expect(client.release).toHaveBeenCalled()
  })

  it('returns metrics for instructor', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    reportRepo.getDashboard.mockResolvedValue({ total_bookings: 50 })

    const res = await app.inject({
      method: 'GET', url: '/v1/reports/dashboard',
      headers: { authorization: makeToken({ role: 'instructor' }) },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 403 for alumno', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/reports/dashboard',
      headers: { authorization: makeToken({ role: 'alumno' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/reports/attendance', () => {
  it('returns attendance data with date filters', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    reportRepo.getAttendance.mockResolvedValue([{ date: '2026-04-18', total_bookings: 5 }])

    const res = await app.inject({
      method: 'GET', url: '/v1/reports/attendance?from=2026-04-01&to=2026-04-30',
      headers: { authorization: makeToken({ role: 'admin' }) },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(reportRepo.getAttendance).toHaveBeenCalledWith(
      client, TENANT_ID, { from: '2026-04-01', to: '2026-04-30' },
    )
  })

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/reports/attendance',
      headers: { authorization: makeToken({ role: 'instructor' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /v1/reports/attendance/export', () => {
  it('returns export queued message for admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/reports/attendance/export',
      headers: { authorization: makeToken({ role: 'admin' }) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toContain('Export queued')
  })
})
