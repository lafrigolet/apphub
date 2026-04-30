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
  it('endRoom sets ended and publishes telehealth.room.ended', async () => {
    repo.setRoomStatus.mockResolvedValue({ id: ROOM_ID, booking_id: BOOK_ID })
    await service.endRoom(ctx, ROOM_ID)
    expect(repo.setRoomStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID, 'ended')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.ended' }))
  })

  it('cancelRoom sets cancelled (no event)', async () => {
    repo.setRoomStatus.mockResolvedValue({ id: ROOM_ID })
    await service.cancelRoom(ctx, ROOM_ID)
    expect(repo.setRoomStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ROOM_ID, 'cancelled')
  })

  it('endRoom throws NotFoundError when missing', async () => {
    repo.setRoomStatus.mockResolvedValue(null)
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
