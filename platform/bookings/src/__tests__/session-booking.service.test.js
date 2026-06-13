// bookings.service — createBookingForSession (inscripción a eventos) +
// ramas de cancellation fee no cubiertas (grace window, freeUpToMinutes,
// feeFlatCents). Foco en código NO cubierto por los otros tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/bookings.repository.js')

import { createBooking, cancelBooking } from '../services/bookings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/bookings.repository.js'

const APP = 'wellness'
const TENANT = 't1'
const SVC = 'svc-1'
const SESS = 'sess-1'
const ctx = { appId: APP, tenantId: TENANT, subTenantId: null, userId: 'user-1', role: 'user' }

function future(mins) { return new Date(Date.now() + mins * 60_000).toISOString() }
function past(mins) { return new Date(Date.now() - mins * 60_000).toISOString() }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  repo.listResources.mockResolvedValue([])
  repo.listEvents.mockResolvedValue([])
})

// ── createBookingForSession ──────────────────────────────────────────

describe('createBookingForSession', () => {
  const scheduledSession = {
    id: SESS, service_id: SVC, status: 'scheduled',
    starts_at: future(120), ends_at: future(180),
    capacity: 10, resource_id: 'room-1', registration_closes_at: future(60),
  }
  const eventService = { id: SVC, kind: 'event', capacity: 10, price_cents: 2000, currency: 'EUR' }

  it('session inexistente → NotFoundError 404', async () => {
    repo.loadServiceSession.mockResolvedValue(null)
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('session no scheduled → 409', async () => {
    repo.loadServiceSession.mockResolvedValue({ ...scheduledSession, status: 'cancelled' })
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('registration cerrada → 409', async () => {
    repo.loadServiceSession.mockResolvedValue({ ...scheduledSession, registration_closes_at: past(5) })
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('session ya empezada → 409', async () => {
    repo.loadServiceSession.mockResolvedValue({ ...scheduledSession, starts_at: past(5), registration_closes_at: null })
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('service inexistente → 404', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(null)
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('service kind no reservable por sesión (ni event ni appointment) → ValidationError 422', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    // event y appointment SÍ son reservables por sessionId; cualquier otro kind
    // cae en la guarda defensiva (en la práctica el CHECK del esquema no permite
    // otros, pero la guarda protege ante datos inesperados).
    repo.loadServiceFor.mockResolvedValue({ ...eventService, kind: 'rental' })
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('cliente ya inscrito a la sesión → 409 (no doble inscripción)', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.clientAlreadyEnrolled.mockResolvedValue(true)
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('already enrolled'),
    })
    // No debe siquiera comprobar capacidad ni insertar.
    expect(repo.insertBookingForSession).not.toHaveBeenCalled()
  })

  it('comprueba doble inscripción con el clientUserId resuelto (body override)', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.clientAlreadyEnrolled.mockResolvedValue(false)
    repo.countBookingsForSession.mockResolvedValue(0)
    repo.insertBookingForSession.mockResolvedValue({
      id: 'b9', status: 'confirmed', service_id: SVC, session_id: SESS, client_user_id: 'other',
      starts_at: scheduledSession.starts_at, ends_at: scheduledSession.ends_at,
    })
    repo.findById.mockResolvedValue({ id: 'b9', status: 'confirmed' })
    await createBooking(ctx, { sessionId: SESS, clientUserId: 'other' })
    expect(repo.clientAlreadyEnrolled).toHaveBeenCalledWith(expect.anything(), APP, TENANT, SESS, 'other')
  })

  it('session llena (taken >= capacity) → 409', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.countBookingsForSession.mockResolvedValue(10)
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('insert falla (null) → 409', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.countBookingsForSession.mockResolvedValue(0)
    repo.insertBookingForSession.mockResolvedValue(null)
    await expect(createBooking(ctx, { sessionId: SESS })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('happy → inserta, adjunta resource de la session, publica booking.confirmed', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.countBookingsForSession.mockResolvedValue(2)
    repo.insertBookingForSession.mockResolvedValue({
      id: 'b1', status: 'confirmed', service_id: SVC, session_id: SESS,
      client_user_id: 'user-1', starts_at: scheduledSession.starts_at, ends_at: scheduledSession.ends_at,
    })
    repo.findById.mockResolvedValue({ id: 'b1', status: 'confirmed' })

    const r = await createBooking(ctx, { sessionId: SESS })
    expect(repo.insertBookingForSession).toHaveBeenCalledWith(
      expect.anything(),
      APP, TENANT,
      expect.objectContaining({ sessionId: SESS, serviceId: SVC, status: 'confirmed' }),
    )
    expect(repo.attachResource).toHaveBeenCalledWith(expect.anything(), APP, TENANT, 'b1', 'room-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'booking.confirmed',
      payload: expect.objectContaining({ sessionId: SESS, bookingId: 'b1' }),
    }))
    expect(r.id).toBe('b1')
  })

  it('session sin resource_id ni resourceIds → no adjunta nada; capacity fallback al service', async () => {
    repo.loadServiceSession.mockResolvedValue({ ...scheduledSession, resource_id: null, capacity: null })
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.countBookingsForSession.mockResolvedValue(0)
    repo.insertBookingForSession.mockResolvedValue({
      id: 'b2', status: 'confirmed', service_id: SVC, session_id: SESS, client_user_id: 'user-1',
      starts_at: scheduledSession.starts_at, ends_at: scheduledSession.ends_at,
    })
    repo.findById.mockResolvedValue({ id: 'b2', status: 'confirmed' })
    await createBooking(ctx, { sessionId: SESS })
    expect(repo.attachResource).not.toHaveBeenCalled()
  })

  it('body.resourceIds override el resource de la session', async () => {
    repo.loadServiceSession.mockResolvedValue(scheduledSession)
    repo.loadServiceFor.mockResolvedValue(eventService)
    repo.countBookingsForSession.mockResolvedValue(0)
    repo.insertBookingForSession.mockResolvedValue({
      id: 'b3', status: 'confirmed', service_id: SVC, session_id: SESS, client_user_id: 'user-1',
      starts_at: scheduledSession.starts_at, ends_at: scheduledSession.ends_at,
    })
    repo.findById.mockResolvedValue({ id: 'b3', status: 'confirmed' })
    await createBooking(ctx, { sessionId: SESS, resourceIds: ['custom-room'] })
    expect(repo.attachResource).toHaveBeenCalledWith(expect.anything(), APP, TENANT, 'b3', 'custom-room')
  })
})

// ── cancellation fee branches ────────────────────────────────────────

describe('cancelBooking — evaluación de fee (ramas)', () => {
  function setupCancel(policy, bookingOverrides = {}) {
    const booking = {
      id: 'bk', status: 'confirmed', service_id: SVC,
      starts_at: future(120), created_at: past(120),
      price_cents: 5000, currency: 'EUR', client_user_id: 'u1',
      ...bookingOverrides,
    }
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ cancellation_policy: policy, price_cents: 5000, currency: 'EUR' }] }),
    }
    repo.findById.mockResolvedValue(booking)
    repo.setStatus.mockResolvedValue({ ...booking, status: 'cancelled' })
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
    return booking
  }

  it('sin policy (null) → feeCents 0, sólo booking.cancelled', async () => {
    setupCancel(null)
    await cancelBooking(ctx, 'bk', 'change of mind')
    const cancelEvt = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancelEvt[0].payload.feeCents).toBe(0)
    expect(publish.mock.calls.some((c) => c[0].type === 'booking.fee.charged')).toBe(false)
  })

  it('dentro del grace window → feeCents 0', async () => {
    setupCancel({ graceMinutesAfterCreate: 60, feePercent: 100 }, { created_at: past(10) })
    await cancelBooking(ctx, 'bk', 'oops')
    const cancelEvt = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancelEvt[0].payload.feeCents).toBe(0)
    expect(cancelEvt[0].payload.feeReason).toMatch(/grace window/)
  })

  it('freeUpToMinutes: cancela con suficiente antelación → feeCents 0', async () => {
    setupCancel({ freeUpToMinutes: 60, feePercent: 100 }, { starts_at: future(120) })
    await cancelBooking(ctx, 'bk', 'plenty of time')
    const cancelEvt = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancelEvt[0].payload.feeCents).toBe(0)
    expect(cancelEvt[0].payload.feeReason).toMatch(/before start/)
  })

  it('feePercent tarde → feeCents > 0 + booking.fee.charged', async () => {
    setupCancel({ freeUpToMinutes: 1440, feePercent: 50 }, { starts_at: future(60), price_cents: 5000 })
    await cancelBooking(ctx, 'bk', 'late')
    const cancelEvt = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancelEvt[0].payload.feeCents).toBe(2500)
    expect(publish.mock.calls.some((c) => c[0].type === 'booking.fee.charged')).toBe(true)
  })

  it('feeFlatCents (sin feePercent) → cobra el flat', async () => {
    setupCancel({ freeUpToMinutes: 1440, feeFlatCents: 700 }, { starts_at: future(60) })
    await cancelBooking(ctx, 'bk', 'late flat')
    const cancelEvt = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancelEvt[0].payload.feeCents).toBe(700)
  })

  it('policy sin fee definido → feeCents 0 reason "no fee defined"', async () => {
    setupCancel({ freeUpToMinutes: 1440 }, { starts_at: future(60) })
    await cancelBooking(ctx, 'bk', 'late but no fee')
    const cancelEvt = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancelEvt[0].payload.feeCents).toBe(0)
    expect(cancelEvt[0].payload.feeReason).toMatch(/no fee defined/)
  })
})
