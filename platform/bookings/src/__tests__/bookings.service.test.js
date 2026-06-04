import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
}))
vi.mock('../repositories/bookings.repository.js')

import * as service from '../services/bookings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/bookings.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const BOOK_ID   = '11111111-1111-1111-1111-111111111111'
const SVC_ID    = '22222222-2222-2222-2222-222222222222'
const USER_ID   = '33333333-3333-3333-3333-333333333333'
const RES_ID    = '44444444-4444-4444-4444-444444444444'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('createBooking', () => {
  const baseBody = {
    serviceId: SVC_ID, resourceIds: [RES_ID],
    startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
  }

  it('rejects empty resourceIds', async () => {
    await expect(service.createBooking(ctx, { ...baseBody, resourceIds: [] })).rejects.toThrow(ValidationError)
  })

  it('rejects when endsAt <= startsAt', async () => {
    await expect(service.createBooking(ctx, { ...baseBody, endsAt: baseBody.startsAt })).rejects.toThrow(ValidationError)
  })

  it('persists, attaches resources, records initial event, publishes booking.requested', async () => {
    repo.insertBookingAtomic.mockResolvedValue({
      id: BOOK_ID, status: 'requested', service_id: SVC_ID,
      client_user_id: USER_ID, starts_at: baseBody.startsAt, ends_at: baseBody.endsAt,
    })
    repo.attachResource.mockResolvedValue()
    repo.recordEvent.mockResolvedValue()
    repo.findById.mockResolvedValue({ id: BOOK_ID })
    repo.listResources.mockResolvedValue([RES_ID])
    repo.listEvents.mockResolvedValue([])

    await service.createBooking(ctx, baseBody)
    expect(repo.attachResource).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BOOK_ID, RES_ID)
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, BOOK_ID, null, 'requested', USER_ID, 'booking created',
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'booking.requested',
      payload: expect.objectContaining({ bookingId: BOOK_ID, resourceIds: [RES_ID] }),
    }))
  })

  it('throws ConflictError when atomic insert returns null (slot already taken)', async () => {
    repo.insertBookingAtomic.mockResolvedValue(null)
    await expect(service.createBooking(ctx, baseBody)).rejects.toThrow(ConflictError)
  })

  it('rejects 409 when holdId points to an expired/missing hold', async () => {
    repo.consumeHold.mockResolvedValue(null)
    const HOLD_ID = '55555555-5555-5555-5555-555555555555'
    await expect(service.createBooking(ctx, { ...baseBody, holdId: HOLD_ID })).rejects.toThrow(ConflictError)
    // Atomic insert must not even be attempted when the hold check fails.
    expect(repo.insertBookingAtomic).not.toHaveBeenCalled()
  })

  it('consumes a valid hold and proceeds with the booking', async () => {
    const HOLD_ID = '55555555-5555-5555-5555-555555555555'
    repo.consumeHold.mockResolvedValue({
      id: HOLD_ID,
      service_id: SVC_ID,
      resource_id: RES_ID,
      starts_at: new Date(baseBody.startsAt),
      ends_at:   new Date(baseBody.endsAt),
      client_user_id: USER_ID,
    })
    repo.insertBookingAtomic.mockResolvedValue({
      id: BOOK_ID, status: 'requested', service_id: SVC_ID,
      client_user_id: USER_ID, starts_at: baseBody.startsAt, ends_at: baseBody.endsAt,
    })
    repo.findById.mockResolvedValue({ id: BOOK_ID })
    repo.listResources.mockResolvedValue([RES_ID])
    repo.listEvents.mockResolvedValue([])

    await service.createBooking(ctx, { ...baseBody, holdId: HOLD_ID })
    expect(repo.consumeHold).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, HOLD_ID)
    expect(repo.insertBookingAtomic).toHaveBeenCalled()
  })

  it('rejects 409 when hold window does not match the booking window', async () => {
    const HOLD_ID = '55555555-5555-5555-5555-555555555555'
    repo.consumeHold.mockResolvedValue({
      id: HOLD_ID,
      service_id: SVC_ID,
      resource_id: RES_ID,
      // 5 min later — mismatch
      starts_at: new Date('2026-05-01T10:05:00Z'),
      ends_at:   new Date('2026-05-01T10:35:00Z'),
      client_user_id: USER_ID,
    })
    await expect(service.createBooking(ctx, { ...baseBody, holdId: HOLD_ID })).rejects.toThrow(ConflictError)
  })

  it('rejects 409 when hold resource is not in the booking resources', async () => {
    const HOLD_ID  = '55555555-5555-5555-5555-555555555555'
    const OTHER_R  = '66666666-6666-6666-6666-666666666666'
    repo.consumeHold.mockResolvedValue({
      id: HOLD_ID,
      service_id: SVC_ID,
      resource_id: OTHER_R,
      starts_at: new Date(baseBody.startsAt),
      ends_at:   new Date(baseBody.endsAt),
      client_user_id: USER_ID,
    })
    await expect(service.createBooking(ctx, { ...baseBody, holdId: HOLD_ID })).rejects.toThrow(ConflictError)
  })
})

describe('getBooking / listBookings', () => {
  it('getBooking throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getBooking(ctx, BOOK_ID)).rejects.toThrow(NotFoundError)
  })

  it('getBooking returns booking with resourceIds + events', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID })
    repo.listResources.mockResolvedValue([RES_ID])
    repo.listEvents.mockResolvedValue([{ to_status: 'requested' }])
    const r = await service.getBooking(ctx, BOOK_ID)
    expect(r.resourceIds).toEqual([RES_ID])
    expect(r.events).toHaveLength(1)
  })

  it('listBookings passes filters', async () => {
    repo.listBookings.mockResolvedValue([])
    await service.listBookings(ctx, { from: 'a', to: 'b', clientUserId: 'c', resourceId: 'r', status: 'confirmed' })
    expect(repo.listBookings).toHaveBeenCalled()
  })
})

describe('changeStatus FSM', () => {
  it('requested → confirmed publishes booking.confirmed', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID, status: 'requested', service_id: SVC_ID, client_user_id: USER_ID })
    repo.setStatus.mockResolvedValue({ id: BOOK_ID, status: 'confirmed', service_id: SVC_ID, client_user_id: USER_ID })
    repo.recordEvent.mockResolvedValue()
    repo.listResources.mockResolvedValue([RES_ID])
    await service.changeStatus(ctx, BOOK_ID, 'confirmed')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.confirmed' }))
  })

  it('confirmed → checked_in is allowed', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID, status: 'confirmed', service_id: SVC_ID, client_user_id: USER_ID })
    repo.setStatus.mockResolvedValue({ id: BOOK_ID, status: 'checked_in' })
    repo.recordEvent.mockResolvedValue()
    repo.listResources.mockResolvedValue([])
    await service.changeStatus(ctx, BOOK_ID, 'checked_in')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.checked_in' }))
  })

  it('rejects invalid transition requested → completed', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID, status: 'requested' })
    await expect(service.changeStatus(ctx, BOOK_ID, 'completed')).rejects.toThrow(ConflictError)
  })

  it('rejects from terminal state cancelled', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID, status: 'cancelled' })
    await expect(service.changeStatus(ctx, BOOK_ID, 'confirmed')).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.changeStatus(ctx, BOOK_ID, 'confirmed')).rejects.toThrow(NotFoundError)
  })

  it('cancelBooking shorthand works', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID, status: 'confirmed', service_id: SVC_ID, client_user_id: USER_ID })
    repo.setStatus.mockResolvedValue({ id: BOOK_ID, status: 'cancelled' })
    repo.recordEvent.mockResolvedValue()
    repo.listResources.mockResolvedValue([])
    await service.cancelBooking(ctx, BOOK_ID, 'changed mind')
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BOOK_ID, 'cancelled')
  })
})

describe('reschedule', () => {
  const newSlot = { startsAt: '2026-05-02T10:00:00Z', endsAt: '2026-05-02T10:30:00Z' }

  it('rejects when endsAt <= startsAt', async () => {
    await expect(service.reschedule(ctx, BOOK_ID, { startsAt: newSlot.startsAt, endsAt: newSlot.startsAt }))
      .rejects.toThrow(ValidationError)
  })

  it('throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.reschedule(ctx, BOOK_ID, newSlot)).rejects.toThrow(NotFoundError)
  })

  it('rejects rescheduling a completed booking', async () => {
    repo.findById.mockResolvedValue({ id: BOOK_ID, status: 'completed' })
    await expect(service.reschedule(ctx, BOOK_ID, newSlot)).rejects.toThrow(ConflictError)
  })

  it('marks original rescheduled, clones with new slot, publishes booking.rescheduled', async () => {
    repo.findById
      .mockResolvedValueOnce({
        id: BOOK_ID, status: 'confirmed', service_id: SVC_ID, client_user_id: USER_ID,
        sub_tenant_id: null, source: 'portal', metadata: {},
      })
      .mockResolvedValueOnce({ id: 'NEW' })
    repo.setStatus.mockResolvedValue({ id: BOOK_ID, status: 'rescheduled' })
    repo.recordEvent.mockResolvedValue()
    repo.insertBookingAtomic.mockResolvedValue({ id: 'NEW' })
    repo.listResources.mockResolvedValue([RES_ID])
    repo.attachResource.mockResolvedValue()
    repo.listEvents.mockResolvedValue([])

    await service.reschedule(ctx, BOOK_ID, newSlot)
    expect(repo.setStatus).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, BOOK_ID, 'rescheduled', expect.objectContaining(newSlot),
    )
    // El clon ahora pasa por el overlap-guard atómico cuando hay recursos.
    expect(repo.insertBookingAtomic).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ status: 'confirmed', parentBookingId: BOOK_ID, ...newSlot }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'booking.rescheduled',
      payload: expect.objectContaining({ oldBookingId: BOOK_ID, newBookingId: 'NEW' }),
    }))
  })
})

describe('waitlist', () => {
  it('addToWaitlist publishes booking.waitlist.added', async () => {
    repo.insertWaitlist.mockResolvedValue({ id: 'w1', service_id: SVC_ID })
    await service.addToWaitlist(ctx, { serviceId: SVC_ID })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.waitlist.added' }))
  })

  it('notifyWaitlist publishes booking.waitlist.notified', async () => {
    repo.updateWaitlistStatus.mockResolvedValue({ id: 'w1', client_phone: '+34111' })
    await service.notifyWaitlist(ctx, 'w1')
    expect(repo.updateWaitlistStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'w1', 'notified')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.waitlist.notified' }))
  })

  it('notifyWaitlist throws NotFoundError when missing', async () => {
    repo.updateWaitlistStatus.mockResolvedValue(null)
    await expect(service.notifyWaitlist(ctx, 'w1')).rejects.toThrow(NotFoundError)
  })
})

describe('recurrences', () => {
  it('createRecurrence delega en repo.insertRecurrence', async () => {
    repo.insertRecurrence.mockResolvedValue({ id: 'r1', rrule: { freq: 'WEEKLY' } })
    const body = { rrule: { freq: 'WEEKLY' }, startsOn: '2026-06-01' }
    const r = await service.createRecurrence(ctx, body)
    expect(repo.insertRecurrence).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, body)
    expect(r).toEqual({ id: 'r1', rrule: { freq: 'WEEKLY' } })
  })

  it('listRecurrences delega filtros en repo', async () => {
    repo.listRecurrences.mockResolvedValue([{ id: 'r1' }])
    const r = await service.listRecurrences(ctx, { limit: 50 })
    expect(repo.listRecurrences).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { limit: 50 })
    expect(r).toHaveLength(1)
  })

  it('getRecurrence devuelve la fila cuando existe', async () => {
    repo.findRecurrenceById.mockResolvedValue({ id: 'r1' })
    expect(await service.getRecurrence(ctx, 'r1')).toEqual({ id: 'r1' })
  })

  it('getRecurrence → NotFoundError cuando no existe', async () => {
    repo.findRecurrenceById.mockResolvedValue(null)
    await expect(service.getRecurrence(ctx, 'ghost')).rejects.toThrow(NotFoundError)
  })
})
