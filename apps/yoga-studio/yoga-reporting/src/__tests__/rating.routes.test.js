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
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import * as reportRepo from '../repositories/reporting.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BOOKING_ID = '55555555-5555-5555-5555-555555555555'
const INSTRUCTOR_ID = '22222222-2222-2222-2222-222222222222'
const RATING_ID = '99999999-9999-9999-9999-999999999999'

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

describe('POST /v1/ratings', () => {
  it('creates rating and returns 201', async () => {
    const rating = { id: RATING_ID, booking_id: BOOKING_ID, stars: 5, tenant_id: TENANT_ID }
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    reportRepo.createRating.mockResolvedValue(rating)
    reportRepo.upsertInstructorSummary.mockResolvedValue()

    const res = await app.inject({
      method: 'POST', url: '/v1/ratings',
      headers: { authorization: makeToken() },
      payload: { bookingId: BOOKING_ID, instructorId: INSTRUCTOR_ID, stars: 5, comment: 'Excellent class!' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.stars).toBe(5)
    expect(reportRepo.createRating).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: USER_ID, bookingId: BOOKING_ID, tenantId: TENANT_ID }),
    )
    expect(reportRepo.upsertInstructorSummary).toHaveBeenCalledWith(
      expect.anything(), INSTRUCTOR_ID, TENANT_ID,
    )
  })

  it('does not upsert instructor summary when no instructorId provided', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
    reportRepo.createRating.mockResolvedValue({ id: RATING_ID, stars: 4 })

    const res = await app.inject({
      method: 'POST', url: '/v1/ratings',
      headers: { authorization: makeToken() },
      payload: { bookingId: BOOKING_ID, stars: 4 },
    })

    expect(res.statusCode).toBe(201)
    expect(reportRepo.upsertInstructorSummary).not.toHaveBeenCalled()
  })

  it('returns 422 on invalid stars value', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/ratings',
      headers: { authorization: makeToken() },
      payload: { bookingId: BOOKING_ID, stars: 6 },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when stars below 1', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/ratings',
      headers: { authorization: makeToken() },
      payload: { bookingId: BOOKING_ID, stars: 0 },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when comment exceeds 500 chars', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/ratings',
      headers: { authorization: makeToken() },
      payload: { bookingId: BOOKING_ID, stars: 5, comment: 'x'.repeat(501) },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/ratings',
      payload: { bookingId: BOOKING_ID, stars: 5 },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /v1/ratings/instructor/:id', () => {
  it('returns instructor rating summary', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    const summary = { avg_rating: 4.8, total_ratings: 32, recent_ratings: [] }
    reportRepo.getInstructorRatings.mockResolvedValue(summary)

    const res = await app.inject({
      method: 'GET', url: `/v1/ratings/instructor/${INSTRUCTOR_ID}`,
      headers: { authorization: makeToken() },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.avg_rating).toBe(4.8)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
  })

  it('returns default empty object when instructor has no ratings', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    reportRepo.getInstructorRatings.mockResolvedValue({ avg_rating: null, total_ratings: 0, recent_ratings: [] })

    const res = await app.inject({
      method: 'GET', url: `/v1/ratings/instructor/${INSTRUCTOR_ID}`,
      headers: { authorization: makeToken() },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.total_ratings).toBe(0)
  })
})
