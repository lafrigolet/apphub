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
  subscribe: vi.fn(),
}))
vi.mock('../repositories/telehealth.repository.js')

import * as service from '../services/telehealth.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/telehealth.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ROOM_ID   = '11111111-1111-1111-1111-111111111111'
const BOOK_ID   = '22222222-2222-2222-2222-222222222222'
const SVC_ID    = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'practitioner' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('createRoom', () => {
  it('persists with stub provider, computes expiresAt with 30-min grace, publishes', async () => {
    repo.insertRoom.mockResolvedValue({
      id: ROOM_ID, booking_id: BOOK_ID,
      join_url: 'https://x', starts_at: '2026-05-01T10:00:00Z', ends_at: '2026-05-01T10:30:00Z',
    })
    await service.createRoom(ctx, {
      bookingId: BOOK_ID, startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
    })
    const call = repo.insertRoom.mock.calls[0][3]
    expect(call.provider).toBe('stub')
    expect(call.externalRoomId).toMatch(/^room_/)
    expect(call.joinUrl).toMatch(/^https:\/\/telehealth\.local\/rooms\/room_/)
    // 30 min after the scheduled end
    expect(call.expiresAt).toBe('2026-05-01T11:00:00.000Z')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.created' }))
  })
})

describe('getRoom', () => {
  it('throws NotFoundError when missing', async () => {
    repo.findRoomById.mockResolvedValue(null)
    await expect(service.getRoom(ctx, ROOM_ID)).rejects.toThrow(NotFoundError)
  })

  it('returns room when present', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID })
    const r = await service.getRoom(ctx, ROOM_ID)
    expect(r.id).toBe(ROOM_ID)
  })
})

describe('issueToken', () => {
  it('issues a base64url token with same expiresAt as the room', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, status: 'created', expires_at: '2026-05-01T11:00:00Z' })
    repo.insertToken.mockImplementation(async (_c, _a, _t, args) => ({ id: 'tk1', ...args }))
    const tk = await service.issueToken(ctx, ROOM_ID, { participantRole: 'host' })
    expect(repo.insertToken).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({
        roomId: ROOM_ID, userId: 'u1', participantRole: 'host', expiresAt: '2026-05-01T11:00:00Z',
      }),
    )
    expect(tk.token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects when room is ended/cancelled/expired', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, status: 'ended' })
    await expect(service.issueToken(ctx, ROOM_ID, { participantRole: 'host' }))
      .rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when room missing', async () => {
    repo.findRoomById.mockResolvedValue(null)
    await expect(service.issueToken(ctx, ROOM_ID, { participantRole: 'host' }))
      .rejects.toThrow(NotFoundError)
  })
})

describe('endRoom / cancelRoom', () => {
  it('endRoom sets ended, records transition and publishes telehealth.room.ended', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, status: 'created' })
    repo.setRoomStatus.mockResolvedValue({ id: ROOM_ID, booking_id: BOOK_ID })
    repo.insertRoomEvent.mockResolvedValue({})
    await service.endRoom(ctx, ROOM_ID)
    expect(repo.setRoomStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID, 'ended')
    expect(repo.insertRoomEvent).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ roomId: ROOM_ID, fromStatus: 'created', toStatus: 'ended' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.ended' }))
  })

  it('cancelRoom sets cancelled and publishes telehealth.room.cancelled', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, status: 'created' })
    repo.setRoomStatus.mockResolvedValue({ id: ROOM_ID })
    repo.insertRoomEvent.mockResolvedValue({})
    await service.cancelRoom(ctx, ROOM_ID)
    expect(repo.setRoomStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID, 'cancelled')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.cancelled' }))
  })

  it('endRoom throws NotFoundError when missing', async () => {
    repo.findRoomById.mockResolvedValue(null)
    await expect(service.endRoom(ctx, ROOM_ID)).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking.confirmed', () => {
  it('auto-provisions a room when service modality is telehealth', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ modality: 'telehealth' }] })
      return fn(c)
    })
    repo.findRoomByBookingId.mockResolvedValue(null)
    repo.insertRoom.mockResolvedValue({ id: ROOM_ID, join_url: 'https://x' })
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z', clientUserId: 'u1',
      },
    })
    expect(repo.insertRoom).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.created' }))
  })

  it('skips when modality is in_person', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ modality: 'in_person' }] })
      return fn(c)
    })
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })
    expect(repo.insertRoom).not.toHaveBeenCalled()
  })

  it('hybrid modality also provisions', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ modality: 'hybrid' }] })
      return fn(c)
    })
    repo.findRoomByBookingId.mockResolvedValue(null)
    repo.insertRoom.mockResolvedValue({ id: ROOM_ID, join_url: 'https://x' })
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })
    expect(repo.insertRoom).toHaveBeenCalled()
  })

  it('de-dupes if a room already exists for the booking', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ modality: 'telehealth' }] })
      return fn(c)
    })
    repo.findRoomByBookingId.mockResolvedValue({ id: 'existing' })
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })
    expect(repo.insertRoom).not.toHaveBeenCalled()
  })

  it('ignores unrelated event types', async () => {
    await service.handleEvent({ type: 'booking.cancelled', payload: {} })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('ignores booking.confirmed without payload (defaults to {})', async () => {
    await service.handleEvent({ type: 'booking.confirmed' })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('ignores booking.confirmed missing required fields', async () => {
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID }, // no bookingId/serviceId
    })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    withTenantTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(service.handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID,
        startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T10:30:00Z',
      },
    })).resolves.toBeUndefined()
  })
})

describe('handleEvent — booking.cancelled / rescheduled / no_show', () => {
  function withRoom(room) {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findRoomByBookingId.mockResolvedValue(room)
  }

  it('booking.cancelled cancels a pre-session room and publishes', async () => {
    withRoom({ id: ROOM_ID, status: 'created', booking_id: BOOK_ID })
    repo.setRoomStatus.mockResolvedValue({ id: ROOM_ID, status: 'cancelled', booking_id: BOOK_ID })
    repo.insertRoomEvent.mockResolvedValue({})
    await service.handleEvent({ type: 'booking.cancelled', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.setRoomStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID, 'cancelled')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.cancelled' }))
  })

  it('booking.cancelled skips when no room exists', async () => {
    withRoom(null)
    await service.handleEvent({ type: 'booking.cancelled', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.setRoomStatus).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('booking.cancelled skips a terminal room', async () => {
    withRoom({ id: ROOM_ID, status: 'ended', booking_id: BOOK_ID })
    await service.handleEvent({ type: 'booking.cancelled', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.setRoomStatus).not.toHaveBeenCalled()
  })

  it('booking.rescheduled shifts the schedule with 30-min grace', async () => {
    withRoom({ id: ROOM_ID, status: 'created', booking_id: BOOK_ID })
    repo.updateRoomSchedule.mockResolvedValue({ id: ROOM_ID, status: 'created', booking_id: BOOK_ID })
    repo.insertRoomEvent.mockResolvedValue({})
    await service.handleEvent({
      type: 'booking.rescheduled',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, startsAt: '2026-06-01T09:00:00Z', endsAt: '2026-06-01T09:30:00Z' },
    })
    expect(repo.updateRoomSchedule).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID,
      expect.objectContaining({ startsAt: '2026-06-01T09:00:00Z', endsAt: '2026-06-01T09:30:00Z', expiresAt: '2026-06-01T10:00:00.000Z' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.rescheduled' }))
  })

  it('booking.rescheduled without dates is a no-op', async () => {
    withRoom({ id: ROOM_ID, status: 'created', booking_id: BOOK_ID })
    await service.handleEvent({ type: 'booking.rescheduled', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.updateRoomSchedule).not.toHaveBeenCalled()
  })

  it('booking.no_show expires the room', async () => {
    withRoom({ id: ROOM_ID, status: 'active', booking_id: BOOK_ID })
    repo.setRoomStatus.mockResolvedValue({ id: ROOM_ID, status: 'expired', booking_id: BOOK_ID })
    repo.insertRoomEvent.mockResolvedValue({})
    await service.handleEvent({ type: 'booking.no_show', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.setRoomStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID, 'expired')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.expired' }))
  })

  it('ignores booking change without bookingId', async () => {
    await service.handleEvent({ type: 'booking.cancelled', payload: { appId: APP_ID, tenantId: TENANT_ID } })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })
})

describe('expireStaleRooms', () => {
  it('expires rooms, records events and publishes per room', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.expireStaleRooms.mockResolvedValue([
      { id: 'r1', booking_id: 'b1' }, { id: 'r2', booking_id: 'b2' },
    ])
    repo.insertRoomEvent.mockResolvedValue({})
    const out = await service.expireStaleRooms(ctx)
    expect(out).toHaveLength(2)
    expect(repo.insertRoomEvent).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.expired' }))
  })

  it('no events/publish when nothing expired', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.expireStaleRooms.mockResolvedValue([])
    await service.expireStaleRooms(ctx)
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('setRecordingConsent', () => {
  it('records consent and an audit event', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, status: 'created' })
    repo.setRecordingConsent.mockResolvedValue({ id: ROOM_ID, recording_consent_status: 'granted' })
    repo.insertRoomEvent.mockResolvedValue({})
    const out = await service.setRecordingConsent(ctx, ROOM_ID, { status: 'granted', text: 'ok' })
    expect(repo.setRecordingConsent).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID,
      expect.objectContaining({ status: 'granted', by: 'u1', text: 'ok' }))
    expect(out.recording_consent_status).toBe('granted')
  })

  it('rejects consent on a terminal room', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, status: 'ended' })
    await expect(service.setRecordingConsent(ctx, ROOM_ID, { status: 'granted' })).rejects.toThrow(ConflictError)
  })

  it('throws NotFound when room missing', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findRoomById.mockResolvedValue(null)
    await expect(service.setRecordingConsent(ctx, ROOM_ID, { status: 'granted' })).rejects.toThrow(NotFoundError)
  })
})

describe('listRoomEvents', () => {
  it('returns events when room exists', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID })
    repo.listRoomEvents.mockResolvedValue([{ id: 'e1' }])
    const out = await service.listRoomEvents(ctx, ROOM_ID)
    expect(out).toEqual([{ id: 'e1' }])
  })
  it('throws NotFound when room missing', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    repo.findRoomById.mockResolvedValue(null)
    await expect(service.listRoomEvents(ctx, ROOM_ID)).rejects.toThrow(NotFoundError)
  })
})

describe('session notes', () => {
  beforeEach(() => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  })

  it('createNote requires an existing room and defaults author/booking', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID, booking_id: BOOK_ID })
    repo.insertNote.mockImplementation(async (_c, _a, _t, n) => ({ id: 'n1', ...n }))
    const out = await service.createNote(ctx, ROOM_ID, { subjective: 'S' })
    expect(repo.insertNote).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ roomId: ROOM_ID, bookingId: BOOK_ID, authorId: 'u1', subjective: 'S' }))
    expect(out.id).toBe('n1')
  })

  it('createNote throws NotFound when room missing', async () => {
    repo.findRoomById.mockResolvedValue(null)
    await expect(service.createNote(ctx, ROOM_ID, {})).rejects.toThrow(NotFoundError)
  })

  it('listNotes returns notes for an existing room', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM_ID })
    repo.listNotesByRoom.mockResolvedValue([{ id: 'n1' }])
    expect(await service.listNotes(ctx, ROOM_ID)).toEqual([{ id: 'n1' }])
  })

  it('updateNote rejects a signed note', async () => {
    repo.findNoteById.mockResolvedValue({ id: 'n1', signed_at: '2026-01-01' })
    await expect(service.updateNote(ctx, 'n1', { plan: 'P' })).rejects.toThrow(ConflictError)
  })

  it('updateNote updates an unsigned note', async () => {
    repo.findNoteById.mockResolvedValue({ id: 'n1', signed_at: null })
    repo.updateNote.mockResolvedValue({ id: 'n1', plan: 'P' })
    expect(await service.updateNote(ctx, 'n1', { plan: 'P' })).toEqual({ id: 'n1', plan: 'P' })
  })

  it('updateNote throws NotFound when note missing', async () => {
    repo.findNoteById.mockResolvedValue(null)
    await expect(service.updateNote(ctx, 'n1', {})).rejects.toThrow(NotFoundError)
  })

  it('signNote signs an unsigned note', async () => {
    repo.findNoteById.mockResolvedValue({ id: 'n1', signed_at: null })
    repo.signNote.mockResolvedValue({ id: 'n1', signed_at: 'now' })
    expect((await service.signNote(ctx, 'n1')).signed_at).toBe('now')
  })

  it('signNote rejects an already-signed note', async () => {
    repo.findNoteById.mockResolvedValue({ id: 'n1', signed_at: 'now' })
    await expect(service.signNote(ctx, 'n1')).rejects.toThrow(ConflictError)
  })
})
