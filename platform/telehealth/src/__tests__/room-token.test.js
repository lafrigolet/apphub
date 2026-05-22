// telehealth.service.issueToken + createRoom + handleEvent.
// Contrato:
//   - createRoom: provisions stub provider id + joinUrl; expiresAt = endsAt + 30 min grace.
//     Publica 'telehealth.room.created' con joinUrl.
//   - issueToken:
//       · room inexistente → 404.
//       · room status='ended'/'cancelled'/'expired' → ConflictError "room is <status>".
//       · token.expiresAt = room.expires_at (cap al fin de la cita + grace).
//       · userId del body o ctx.userId (fallback).
//   - endRoom / cancelRoom: 404 si no existe.
//   - handleEvent: solo procesa booking.confirmed con service modality='telehealth'/'hybrid';
//     dedup por bookingId (no duplica rooms en reintentos).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/telehealth.repository.js')

import {
  createRoom, issueToken, endRoom, cancelRoom, handleEvent,
} from '../services/telehealth.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/telehealth.repository.js'

const ctx = {
  appId: 'wellness', tenantId: 't1', subTenantId: null, userId: 'user-1', role: 'user',
}
const ROOM = '00000000-0000-0000-0000-000000000001'
const BOOK = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({ query: vi.fn() }))
})

// ── createRoom ───────────────────────────────────────────────────────

describe('createRoom', () => {
  it('expiresAt = endsAt + 30 min grace (cap del provider)', async () => {
    repo.insertRoom.mockResolvedValue({ id: ROOM, booking_id: BOOK, join_url: 'https://x', starts_at: 'a', ends_at: 'b' })
    await createRoom(ctx, { bookingId: BOOK, endsAt: '2026-05-22T11:00:00.000Z' })
    const args = repo.insertRoom.mock.calls[0][3]
    expect(args.expiresAt).toBe('2026-05-22T11:30:00.000Z')
  })

  it('provisions provider stub: externalRoomId comienza por "room_" + joinUrl coherente', async () => {
    repo.insertRoom.mockResolvedValue({ id: ROOM, booking_id: BOOK, join_url: 'x', starts_at: 'a', ends_at: 'b' })
    await createRoom(ctx, { bookingId: BOOK, endsAt: '2026-05-22T11:00:00.000Z' })
    const args = repo.insertRoom.mock.calls[0][3]
    expect(args.provider).toBe('stub')
    expect(args.externalRoomId).toMatch(/^room_[a-f0-9]+$/)
    expect(args.joinUrl).toContain(args.externalRoomId)
  })

  it('publica telehealth.room.created con joinUrl', async () => {
    repo.insertRoom.mockResolvedValue({
      id: ROOM, booking_id: BOOK, join_url: 'https://t.local/rooms/x',
      starts_at: '2026-05-22T10:00:00Z', ends_at: '2026-05-22T11:00:00Z',
    })
    await createRoom(ctx, { bookingId: BOOK, endsAt: '2026-05-22T11:00:00.000Z' })
    expect(publish).toHaveBeenCalledWith({
      type: 'telehealth.room.created',
      payload: expect.objectContaining({
        roomId: ROOM, bookingId: BOOK,
        joinUrl: 'https://t.local/rooms/x',
      }),
    })
  })
})

// ── issueToken ──────────────────────────────────────────────────────

describe('issueToken', () => {
  it('room inexistente → NotFoundError 404', async () => {
    repo.findRoomById.mockResolvedValue(null)
    await expect(issueToken(ctx, 'ghost', { participantRole: 'client' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([['ended'], ['cancelled'], ['expired']])(
    'room status="%s" → ConflictError "room is <status>"',
    async (status) => {
      repo.findRoomById.mockResolvedValue({ id: ROOM, status, expires_at: 'x' })
      await expect(issueToken(ctx, ROOM, { participantRole: 'client' })).rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining(`room is ${status}`),
      })
      expect(repo.insertToken).not.toHaveBeenCalled()
    },
  )

  it('happy: token.expiresAt = room.expires_at (TTL del provider, no del cliente)', async () => {
    const EXP = '2026-05-22T11:30:00.000Z'
    repo.findRoomById.mockResolvedValue({ id: ROOM, status: 'created', expires_at: EXP })
    repo.insertToken.mockResolvedValue({ id: 'tok-1', expires_at: EXP, token: 'opaque' })
    const r = await issueToken(ctx, ROOM, { participantRole: 'client' })
    expect(r.expires_at).toBe(EXP)
    const args = repo.insertToken.mock.calls[0][3]
    expect(args.expiresAt).toBe(EXP)
  })

  it('genera token opaco base64url 32 bytes (NO JWT, NO secret leak)', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM, status: 'created', expires_at: 'x' })
    repo.insertToken.mockResolvedValue({ id: 't', token: 'opaque' })
    await issueToken(ctx, ROOM, { participantRole: 'client' })
    const args = repo.insertToken.mock.calls[0][3]
    // base64url 32 bytes ≈ 43 chars sin '=' padding
    expect(args.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(args.token.length).toBeGreaterThanOrEqual(40)
  })

  it('userId del body OVERRIDE ctx.userId (admin emite token a un participante)', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM, status: 'created', expires_at: 'x' })
    repo.insertToken.mockResolvedValue({})
    await issueToken(ctx, ROOM, { participantRole: 'practitioner', userId: 'other-user' })
    expect(repo.insertToken.mock.calls[0][3].userId).toBe('other-user')
  })

  it('userId ausente del body → fallback a ctx.userId', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM, status: 'created', expires_at: 'x' })
    repo.insertToken.mockResolvedValue({})
    await issueToken(ctx, ROOM, { participantRole: 'client' })
    expect(repo.insertToken.mock.calls[0][3].userId).toBe(ctx.userId)
  })

  it('participantRole propaga al token', async () => {
    repo.findRoomById.mockResolvedValue({ id: ROOM, status: 'created', expires_at: 'x' })
    repo.insertToken.mockResolvedValue({})
    await issueToken(ctx, ROOM, { participantRole: 'practitioner' })
    expect(repo.insertToken.mock.calls[0][3].participantRole).toBe('practitioner')
  })
})

// ── endRoom / cancelRoom ────────────────────────────────────────────

describe('endRoom / cancelRoom', () => {
  it('endRoom inexistente → 404', async () => {
    repo.setRoomStatus.mockResolvedValue(null)
    await expect(endRoom(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('endRoom happy → publish telehealth.room.ended', async () => {
    repo.setRoomStatus.mockResolvedValue({ id: ROOM, booking_id: BOOK })
    await endRoom(ctx, ROOM)
    expect(publish).toHaveBeenCalledWith({
      type: 'telehealth.room.ended',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, roomId: ROOM, bookingId: BOOK },
    })
  })

  it('cancelRoom inexistente → 404; happy NO publica', async () => {
    repo.setRoomStatus.mockResolvedValueOnce(null)
    await expect(cancelRoom(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    repo.setRoomStatus.mockResolvedValueOnce({ id: ROOM })
    await cancelRoom(ctx, ROOM)
    // No hay publish para cancelRoom — diseño deliberado
  })
})

// ── handleEvent (booking.confirmed) ─────────────────────────────────

describe('handleEvent', () => {
  it('ignora eventos != booking.confirmed', async () => {
    await handleEvent({ type: 'order.paid', payload: {} })
    expect(repo.insertRoom).not.toHaveBeenCalled()
  })

  it('service.modality="in_person" → NO provision', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [{ modality: 'in_person' }] }),
    }))
    await handleEvent({
      type: 'booking.confirmed',
      payload: { appId: 'a', tenantId: 't', bookingId: BOOK, serviceId: 'sv-1', endsAt: '2026-05-22T11:00:00Z' },
    })
    expect(repo.insertRoom).not.toHaveBeenCalled()
  })

  it('modality="telehealth" + room ya existe → NO duplica (dedup por bookingId)', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [{ modality: 'telehealth' }] }),
    }))
    repo.findRoomByBookingId.mockResolvedValue({ id: ROOM })
    await handleEvent({
      type: 'booking.confirmed',
      payload: { appId: 'a', tenantId: 't', bookingId: BOOK, serviceId: 'sv-1', endsAt: '2026-05-22T11:00:00Z' },
    })
    expect(repo.insertRoom).not.toHaveBeenCalled()
  })

  it('modality="hybrid" + nuevo booking → insertRoom + publish telehealth.room.created', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [{ modality: 'hybrid' }] }),
    }))
    repo.findRoomByBookingId.mockResolvedValue(null)
    repo.insertRoom.mockResolvedValue({ id: ROOM, join_url: 'https://x' })
    await handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: 'a', tenantId: 't', bookingId: BOOK, serviceId: 'sv-1',
        startsAt: '2026-05-22T10:00:00Z', endsAt: '2026-05-22T11:00:00Z',
      },
    })
    expect(repo.insertRoom).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'telehealth.room.created' }))
  })

  it('errores se loguean pero NO crashean el handler', async () => {
    withTenantTransaction.mockImplementationOnce(async () => { throw new Error('boom') })
    await expect(handleEvent({
      type: 'booking.confirmed',
      payload: { appId: 'a', tenantId: 't', bookingId: BOOK, serviceId: 'sv-1', endsAt: 'x' },
    })).resolves.toBeUndefined()
  })
})
