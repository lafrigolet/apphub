import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_BONUSES_INTERNAL_URL: 'http://yoga-bonuses:3014',
    YOGA_CLASSES_INTERNAL_URL: 'http://yoga-classes:3012',
  },
}))

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({
  redis: { setex: vi.fn() },
  publish: vi.fn(),
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

vi.mock('../repositories/booking.repository.js')

import * as bookingService from '../services/booking.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { redis, publish } from '../lib/redis.js'
import * as bookingRepo from '../repositories/booking.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const SESSION_ID = '44444444-4444-4444-4444-444444444444'
const BOOKING_ID = '55555555-5555-5555-5555-555555555555'

function mockClient() {
  return { query: vi.fn(), release: vi.fn() }
}

function mockFetch(body, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(mockClient()))
})

describe('booking.service — createBooking', () => {
  it('creates booking when credits available and session has space', async () => {
    const booking = { id: BOOKING_ID, user_id: USER_ID, session_id: SESSION_ID, status: 'confirmed' }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { hasCredits: true } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { spots_taken: 5, max_capacity: 12 } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })

    bookingRepo.createBooking.mockResolvedValue(booking)

    const result = await bookingService.createBooking({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID, subTenantId: null })

    expect(result).toEqual(booking)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.created' }))
    expect(bookingRepo.createBooking).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID }),
    )
  })

  it('adds to waitlist when session is full', async () => {
    const waitlistEntry = { id: 'w1', user_id: USER_ID, position: 13 }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { hasCredits: true } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { spots_taken: 12, max_capacity: 12 } }) })

    bookingRepo.addToWaitlist.mockResolvedValue(waitlistEntry)

    const result = await bookingService.createBooking({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID, subTenantId: null })

    expect(result.waitlisted).toBe(true)
    expect(bookingRepo.addToWaitlist).toHaveBeenCalled()
  })

  it('throws ValidationError when no credits', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { hasCredits: false } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { spots_taken: 0, max_capacity: 12 } }) })

    await expect(bookingService.createBooking({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow('No credits available')
  })

  it('throws ValidationError when dependency services fail', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    await expect(bookingService.createBooking({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow('Could not verify availability')
  })

  it('throws ConflictError when already on waitlist', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { hasCredits: true } }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { spots_taken: 12, max_capacity: 12 } }) })

    bookingRepo.addToWaitlist.mockResolvedValue(null) // conflict

    await expect(bookingService.createBooking({ userId: USER_ID, sessionId: SESSION_ID, tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow('Already on waitlist')
  })
})

describe('booking.service — cancelBooking', () => {
  it('cancels booking and refunds credit via event', async () => {
    const booking = { id: BOOKING_ID, user_id: USER_ID, session_id: SESSION_ID, status: 'confirmed' }
    const cancelled = { ...booking, status: 'cancelled' }
    bookingRepo.findById.mockResolvedValue(booking)
    bookingRepo.cancelBooking.mockResolvedValue(cancelled)
    bookingRepo.nextInWaitlist.mockResolvedValue(null)

    const result = await bookingService.cancelBooking({
      bookingId: BOOKING_ID, userId: USER_ID, reason: 'sick', tenantId: TENANT_ID, subTenantId: null,
    })

    expect(result).toEqual(cancelled)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.cancelled' }))
  })

  it('notifies waitlist when slot becomes available', async () => {
    const booking = { id: BOOKING_ID, user_id: USER_ID, session_id: SESSION_ID, status: 'confirmed' }
    const next = { id: 'w1', user_id: 'next-user', session_id: SESSION_ID }
    bookingRepo.findById.mockResolvedValue(booking)
    bookingRepo.cancelBooking.mockResolvedValue({ ...booking, status: 'cancelled' })
    bookingRepo.nextInWaitlist.mockResolvedValue(next)
    bookingRepo.notifyWaitlist.mockResolvedValue()

    await bookingService.cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID, tenantId: TENANT_ID, subTenantId: null })

    expect(bookingRepo.notifyWaitlist).toHaveBeenCalledWith(expect.anything(), 'w1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'waitinglist.spot.available' }))
    expect(redis.setex).toHaveBeenCalled()
  })

  it('throws NotFoundError when booking not found', async () => {
    bookingRepo.findById.mockResolvedValue(null)
    await expect(bookingService.cancelBooking({ bookingId: 'x', userId: USER_ID, tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow('Booking not found')
  })

  it("throws ValidationError when cancelling another user's booking", async () => {
    bookingRepo.findById.mockResolvedValue({ id: BOOKING_ID, user_id: 'different-user', status: 'confirmed' })
    await expect(bookingService.cancelBooking({ bookingId: BOOKING_ID, userId: USER_ID, tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow("Cannot cancel another user's booking")
  })
})

describe('booking.service — confirmAttendance', () => {
  it('marks booking attended and publishes event', async () => {
    const booking = { id: BOOKING_ID, user_id: USER_ID, session_id: SESSION_ID, status: 'confirmed' }
    const attended = { ...booking, status: 'attended' }
    bookingRepo.findById.mockResolvedValue(booking)
    bookingRepo.markAttended.mockResolvedValue(attended)

    const result = await bookingService.confirmAttendance({
      bookingId: BOOKING_ID, instructorId: '22222222-2222-2222-2222-222222222222',
      tenantId: TENANT_ID, subTenantId: null,
    })

    expect(result).toEqual(attended)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.attended' }))
  })

  it('throws NotFoundError when booking not found', async () => {
    bookingRepo.findById.mockResolvedValue(null)
    await expect(bookingService.confirmAttendance({ bookingId: 'x', instructorId: 'i', tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow('Booking not found')
  })

  it('throws ConflictError when booking cannot be marked attended', async () => {
    bookingRepo.findById.mockResolvedValue({ id: BOOKING_ID, status: 'cancelled' })
    bookingRepo.markAttended.mockResolvedValue(null)
    await expect(bookingService.confirmAttendance({ bookingId: BOOKING_ID, instructorId: 'i', tenantId: TENANT_ID, subTenantId: null }))
      .rejects.toThrow('Cannot confirm attendance')
  })
})
