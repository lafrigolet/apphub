import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { redis, publish } from '../lib/redis.js'
import { withTenantTransaction } from '../lib/db.js'
import * as bookingRepo from '../repositories/booking.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'

const BONUSES_URL = process.env.YOGA_BONUSES_INTERNAL_URL ?? 'http://yoga-bonuses:3014'
const CLASSES_URL = process.env.YOGA_CLASSES_INTERNAL_URL ?? 'http://yoga-classes:3012'

function tenantHeaders(tenantId, subTenantId) {
  const headers = { 'X-Tenant-ID': tenantId }
  if (subTenantId) headers['X-Sub-Tenant-ID'] = subTenantId
  return headers
}

async function checkCredits(userId, tenantId, subTenantId) {
  const res = await fetch(`${BONUSES_URL}/internal/bonuses/${userId}/check`, {
    headers: tenantHeaders(tenantId, subTenantId),
    signal: AbortSignal.timeout(1000),
  })
  if (!res.ok) throw new Error(`Bonus service error: ${res.status}`)
  const { data } = await res.json()
  return data
}

async function checkAvailability(sessionId, tenantId, subTenantId) {
  const res = await fetch(`${CLASSES_URL}/v1/sessions/${sessionId}`, {
    headers: tenantHeaders(tenantId, subTenantId),
    signal: AbortSignal.timeout(1000),
  })
  if (!res.ok) throw new Error(`Class service error: ${res.status}`)
  const { data } = await res.json()
  return data
}

async function deductCredit(userId, tenantId, subTenantId) {
  const res = await fetch(`${BONUSES_URL}/internal/bonuses/${userId}/deduct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders(tenantId, subTenantId) },
    signal: AbortSignal.timeout(1000),
  })
  if (!res.ok) throw new Error(`Bonus deduct error: ${res.status}`)
}

export async function createBooking({ userId, sessionId, tenantId, subTenantId }) {
  const [bonusInfo, session] = await Promise.all([
    checkCredits(userId, tenantId, subTenantId),
    checkAvailability(sessionId, tenantId, subTenantId),
  ]).catch((err) => {
    logger.error({ err }, 'Dependency check failed')
    throw new ValidationError('Could not verify availability. Please try again.')
  })

  if (!bonusInfo.hasCredits) throw new ValidationError('No credits available. Please purchase a bonus.')
  if (session.spots_taken >= session.max_capacity) {
    return withTenantTransaction(tenantId, subTenantId, async (client) => {
      const position = session.spots_taken + 1
      const entry = await bookingRepo.addToWaitlist(client, {
        id: uuidv4(), userId, sessionId, position, tenantId, subTenantId,
      })
      if (!entry) throw new ConflictError('Already on waitlist for this session')
      return { waitlisted: true, position }
    })
  }

  await deductCredit(userId, tenantId, subTenantId)

  return withTenantTransaction(tenantId, subTenantId, async (client) => {
    const booking = await bookingRepo.createBooking(client, { id: uuidv4(), userId, sessionId, tenantId, subTenantId })
    await publish({ type: 'booking.created', payload: { bookingId: booking.id, userId, sessionId, tenantId, subTenantId } })
    return booking
  })
}

export async function cancelBooking({ bookingId, userId, reason, tenantId, subTenantId }) {
  return withTenantTransaction(tenantId, subTenantId, async (client) => {
    const booking = await bookingRepo.findById(client, bookingId, tenantId)
    if (!booking) throw new NotFoundError('Booking')
    if (booking.user_id !== userId) throw new ValidationError('Cannot cancel another user\'s booking')
    if (booking.status !== 'confirmed') throw new ConflictError('Booking is not in confirmed state')

    const cancelled = await bookingRepo.cancelBooking(client, bookingId, tenantId, reason)
    if (!cancelled) throw new ConflictError('Could not cancel booking')

    await publish({ type: 'booking.cancelled', payload: { bookingId, userId, sessionId: booking.session_id, tenantId, subTenantId } })

    const next = await bookingRepo.nextInWaitlist(client, booking.session_id, tenantId)
    if (next) {
      await bookingRepo.notifyWaitlist(client, next.id)
      await publish({ type: 'waitinglist.spot.available', payload: { userId: next.user_id, sessionId: booking.session_id, waitlistId: next.id, tenantId, subTenantId } })
      await redis.setex(`yoga:${tenantId}:waitlist_timer:${next.user_id}:${booking.session_id}`, 1800, next.id)
    }

    return cancelled
  })
}

export async function confirmAttendance({ bookingId, instructorId, tenantId, subTenantId }) {
  return withTenantTransaction(tenantId, subTenantId, async (client) => {
    const booking = await bookingRepo.findById(client, bookingId, tenantId)
    if (!booking) throw new NotFoundError('Booking')

    const attended = await bookingRepo.markAttended(client, bookingId, tenantId)
    if (!attended) throw new ConflictError('Cannot confirm attendance for this booking')

    await publish({
      type: 'booking.attended',
      payload: {
        bookingId,
        userId: booking.user_id,
        sessionId: booking.session_id,
        instructorId,
        tenantId,
        subTenantId,
      },
    })

    return attended
  })
}
