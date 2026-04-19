import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_CRON_DATABASE_URL: 'postgres://cron@localhost/test',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    LOG_LEVEL: 'silent',
    YOGA_BOOKINGS_PORT: 3013,
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

vi.mock('../lib/redis.js', () => ({
  redis: { setex: vi.fn() }, publish: vi.fn(),
}))

vi.mock('../services/booking.service.js')
vi.mock('../services/no-show.service.js', () => ({ startNoShowCron: vi.fn() }))
vi.mock('../repositories/booking.repository.js')

import { createApp } from '../app.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as bookingService from '../services/booking.service.js'
import * as bookingRepo from '../repositories/booking.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BOOKING_ID = '55555555-5555-5555-5555-555555555555'
const SESSION_ID = '44444444-4444-4444-4444-444444444444'

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

describe('POST /v1/bookings', () => {
  it('creates booking and returns 201', async () => {
    const booking = { id: BOOKING_ID, session_id: SESSION_ID, status: 'confirmed' }
    bookingService.createBooking.mockResolvedValue(booking)

    const res = await app.inject({
      method: 'POST', url: '/v1/bookings',
      headers: { authorization: makeToken() },
      payload: { sessionId: SESSION_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.status).toBe('confirmed')
    expect(bookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID }),
    )
  })

  it('returns 422 on invalid sessionId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/bookings',
      headers: { authorization: makeToken() },
      payload: { sessionId: 'not-a-uuid' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when no credits', async () => {
    const { ValidationError } = await import('../utils/errors.js')
    bookingService.createBooking.mockRejectedValue(new ValidationError('No credits available. Please purchase a bonus.'))

    const res = await app.inject({
      method: 'POST', url: '/v1/bookings',
      headers: { authorization: makeToken() },
      payload: { sessionId: SESSION_ID },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 201 with waitlist info when session is full', async () => {
    bookingService.createBooking.mockResolvedValue({ waitlisted: true, position: 3 })

    const res = await app.inject({
      method: 'POST', url: '/v1/bookings',
      headers: { authorization: makeToken() },
      payload: { sessionId: SESSION_ID },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.waitlisted).toBe(true)
  })
})

describe('GET /v1/bookings', () => {
  it('returns user bookings', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    bookingRepo.listByUser.mockResolvedValue([{ id: BOOKING_ID }])

    const res = await app.inject({
      method: 'GET', url: '/v1/bookings',
      headers: { authorization: makeToken() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
  })
})

describe('DELETE /v1/bookings/:id', () => {
  it('cancels booking and returns 200', async () => {
    const cancelled = { id: BOOKING_ID, status: 'cancelled' }
    bookingService.cancelBooking.mockResolvedValue(cancelled)

    const res = await app.inject({
      method: 'DELETE', url: `/v1/bookings/${BOOKING_ID}`,
      headers: { authorization: makeToken(), 'content-type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(bookingService.cancelBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, userId: USER_ID }),
    )
  })

  it('returns 404 when booking not found', async () => {
    const { NotFoundError } = await import('../utils/errors.js')
    bookingService.cancelBooking.mockRejectedValue(new NotFoundError('Booking'))

    const res = await app.inject({
      method: 'DELETE', url: `/v1/bookings/${BOOKING_ID}`,
      headers: { authorization: makeToken(), 'content-type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /v1/bookings/:id/attend', () => {
  it('confirms attendance for instructor', async () => {
    const attended = { id: BOOKING_ID, status: 'attended' }
    bookingService.confirmAttendance.mockResolvedValue(attended)

    const res = await app.inject({
      method: 'POST', url: `/v1/bookings/${BOOKING_ID}/attend`,
      headers: { authorization: makeToken({ role: 'instructor' }) },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 403 for alumno', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/bookings/${BOOKING_ID}/attend`,
      headers: { authorization: makeToken({ role: 'alumno' }) },
    })
    expect(res.statusCode).toBe(403)
  })
})
