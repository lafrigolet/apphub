import crypto from 'node:crypto'
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish, subscribe } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/telehealth.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const ROOM_GRACE_MINUTES = 30  // room remains joinable 30 min after scheduled end

// Stub provider — generates opaque ids/urls/tokens. Real integration would call
// Daily.co / Twilio Video / Jitsi here and surface their values.
function provisionRoomStub({ bookingId }) {
  const externalRoomId = `room_${crypto.randomBytes(8).toString('hex')}`
  return {
    provider: 'stub',
    externalRoomId,
    joinUrl: `https://telehealth.local/rooms/${externalRoomId}`,
  }
}

function provisionTokenStub() {
  return crypto.randomBytes(32).toString('base64url')
}

export async function createRoom(ctx, body) {
  const expiresAt = new Date(new Date(body.endsAt).getTime() + ROOM_GRACE_MINUTES * 60_000).toISOString()
  const stub = provisionRoomStub({ bookingId: body.bookingId })

  const room = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertRoom(c, ctx.appId, ctx.tenantId, {
      ...body, ...stub,
      status: 'created', expiresAt,
    }),
  )
  await publish({
    type: 'telehealth.room.created',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, roomId: room.id,
      bookingId: room.booking_id, joinUrl: room.join_url, startsAt: room.starts_at, endsAt: room.ends_at,
    },
  })
  return room
}

export async function getRoom(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findRoomById(c, ctx.appId, ctx.tenantId, id)
    if (!r) throw new NotFoundError('room')
    return r
  })
}

export async function issueToken(ctx, roomId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const room = await repo.findRoomById(c, ctx.appId, ctx.tenantId, roomId)
    if (!room) throw new NotFoundError('room')
    if (['ended','cancelled','expired'].includes(room.status)) {
      throw new ConflictError(`room is ${room.status}`)
    }
    const expiresAt = room.expires_at
    return repo.insertToken(c, ctx.appId, ctx.tenantId, {
      roomId,
      userId: body.userId ?? ctx.userId,
      participantRole: body.participantRole,
      token: provisionTokenStub(),
      expiresAt,
    })
  })
}

// Transition a room to a new status while appending an audit row to room_events.
// Runs both writes in the same tenant-scoped transaction.
async function transitionRoom(ctx, id, toStatus, { reason, actor } = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const current = await repo.findRoomById(c, ctx.appId, ctx.tenantId, id)
    if (!current) return null
    const room = await repo.setRoomStatus(c, ctx.appId, ctx.tenantId, id, toStatus)
    await repo.insertRoomEvent(c, ctx.appId, ctx.tenantId, {
      roomId: id,
      fromStatus: current.status,
      toStatus,
      reason: reason ?? null,
      actor: actor ?? ctx.userId ?? 'system',
    })
    return room
  })
}

export async function endRoom(ctx, id, opts = {}) {
  const room = await transitionRoom(ctx, id, 'ended', { reason: opts.reason, actor: opts.actor })
  if (!room) throw new NotFoundError('room')
  await publish({
    type: 'telehealth.room.ended',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, roomId: id, bookingId: room.booking_id },
  })
  return room
}

export async function cancelRoom(ctx, id, opts = {}) {
  const room = await transitionRoom(ctx, id, 'cancelled', { reason: opts.reason, actor: opts.actor })
  if (!room) throw new NotFoundError('room')
  await publish({
    type: 'telehealth.room.cancelled',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, roomId: id, bookingId: room.booking_id },
  })
  return room
}

export async function listRoomEvents(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const room = await repo.findRoomById(c, ctx.appId, ctx.tenantId, id)
    if (!room) throw new NotFoundError('room')
    return repo.listRoomEvents(c, ctx.appId, ctx.tenantId, id)
  })
}

// Record an explicit recording-consent decision for a room (GDPR Art. 9).
export async function setRecordingConsent(ctx, id, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const room = await repo.findRoomById(c, ctx.appId, ctx.tenantId, id)
    if (!room) throw new NotFoundError('room')
    if (['ended', 'cancelled', 'expired'].includes(room.status)) {
      throw new ConflictError(`room is ${room.status}`)
    }
    const updated = await repo.setRecordingConsent(c, ctx.appId, ctx.tenantId, id, {
      status: body.status,
      by: body.by ?? ctx.userId,
      text: body.text,
    })
    await repo.insertRoomEvent(c, ctx.appId, ctx.tenantId, {
      roomId: id, fromStatus: room.status, toStatus: room.status,
      reason: `recording_consent:${body.status}`, actor: body.by ?? ctx.userId ?? 'system',
    })
    return updated
  })
}

// Expire all rooms whose access window has closed. Idempotent; safe to call
// repeatedly. Intended to be driven by platform/scheduler (cross-cutting),
// or manually via the admin endpoint. Publishes one event per expired room.
export async function expireStaleRooms(ctx, limit = 500) {
  const expired = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const rooms = await repo.expireStaleRooms(c, ctx.appId, ctx.tenantId, limit)
    for (const room of rooms) {
      await repo.insertRoomEvent(c, ctx.appId, ctx.tenantId, {
        roomId: room.id, fromStatus: null, toStatus: 'expired',
        reason: 'access_window_closed', actor: 'scheduler',
      })
    }
    return rooms
  })
  for (const room of expired) {
    await publish({
      type: 'telehealth.room.expired',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, roomId: room.id, bookingId: room.booking_id },
    })
  }
  return expired
}

// ---- Post-session clinical notes -----------------------------------------

export async function createNote(ctx, roomId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const room = await repo.findRoomById(c, ctx.appId, ctx.tenantId, roomId)
    if (!room) throw new NotFoundError('room')
    return repo.insertNote(c, ctx.appId, ctx.tenantId, {
      roomId,
      bookingId: body.bookingId ?? room.booking_id ?? null,
      authorId: body.authorId ?? ctx.userId,
      subjective: body.subjective, objective: body.objective,
      assessment: body.assessment, plan: body.plan, body: body.body,
      metadata: body.metadata,
    })
  })
}

export async function listNotes(ctx, roomId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const room = await repo.findRoomById(c, ctx.appId, ctx.tenantId, roomId)
    if (!room) throw new NotFoundError('room')
    return repo.listNotesByRoom(c, ctx.appId, ctx.tenantId, roomId)
  })
}

export async function updateNote(ctx, noteId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const note = await repo.findNoteById(c, ctx.appId, ctx.tenantId, noteId)
    if (!note) throw new NotFoundError('note')
    if (note.signed_at) throw new ConflictError('note is signed and immutable')
    return repo.updateNote(c, ctx.appId, ctx.tenantId, noteId, body)
  })
}

export async function signNote(ctx, noteId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const note = await repo.findNoteById(c, ctx.appId, ctx.tenantId, noteId)
    if (!note) throw new NotFoundError('note')
    if (note.signed_at) throw new ConflictError('note already signed')
    return repo.signNote(c, ctx.appId, ctx.tenantId, noteId)
  })
}

// React to a booking that no longer needs (or has changed) its room.
// booking.cancelled  → cancel the room if still pre-session (created/active).
// booking.rescheduled→ shift starts_at/ends_at/expires_at (re-derive grace).
// booking.no_show    → expire the room and stamp the reason.
async function handleBookingChange(event) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.bookingId) return
  const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: 'system', role: 'system' }

  const result = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const room = await repo.findRoomByBookingId(c, ctx.appId, ctx.tenantId, p.bookingId)
    if (!room) return null
    if (['ended', 'cancelled', 'expired'].includes(room.status)) return null

    if (event.type === 'booking.cancelled') {
      const updated = await repo.setRoomStatus(c, ctx.appId, ctx.tenantId, room.id, 'cancelled')
      await repo.insertRoomEvent(c, ctx.appId, ctx.tenantId, {
        roomId: room.id, fromStatus: room.status, toStatus: 'cancelled',
        reason: 'booking.cancelled', actor: 'system',
      })
      return { type: 'telehealth.room.cancelled', room: updated }
    }

    if (event.type === 'booking.rescheduled') {
      if (!p.startsAt || !p.endsAt) return null
      const expiresAt = new Date(new Date(p.endsAt).getTime() + ROOM_GRACE_MINUTES * 60_000).toISOString()
      const updated = await repo.updateRoomSchedule(c, ctx.appId, ctx.tenantId, room.id, {
        startsAt: p.startsAt, endsAt: p.endsAt, expiresAt,
      })
      if (!updated) return null
      await repo.insertRoomEvent(c, ctx.appId, ctx.tenantId, {
        roomId: room.id, fromStatus: room.status, toStatus: updated.status,
        reason: 'booking.rescheduled', actor: 'system',
        metadata: { startsAt: p.startsAt, endsAt: p.endsAt },
      })
      return { type: 'telehealth.room.rescheduled', room: updated }
    }

    if (event.type === 'booking.no_show') {
      const updated = await repo.setRoomStatus(c, ctx.appId, ctx.tenantId, room.id, 'expired')
      await repo.insertRoomEvent(c, ctx.appId, ctx.tenantId, {
        roomId: room.id, fromStatus: room.status, toStatus: 'expired',
        reason: 'booking.no_show', actor: 'system',
      })
      return { type: 'telehealth.room.expired', room: updated }
    }
    return null
  })

  if (result?.room) {
    await publish({
      type: result.type,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        roomId: result.room.id, bookingId: result.room.booking_id,
        startsAt: result.room.starts_at, endsAt: result.room.ends_at,
      },
    })
  }
}

// Auto-provision a room when a telehealth booking is confirmed.
export async function handleEvent(event) {
  try {
    if (event.type === 'booking.cancelled' || event.type === 'booking.rescheduled' || event.type === 'booking.no_show') {
      return await handleBookingChange(event)
    }
    if (event.type !== 'booking.confirmed') return
    const p = event.payload ?? {}
    if (!p.appId || !p.tenantId || !p.bookingId || !p.serviceId) return

    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: p.clientUserId, role: 'system' }

    await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
      // Look up service modality (cross-schema).
      const { rows } = await c.query(
        `SELECT modality FROM platform_services.services
         WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
        [ctx.appId, ctx.tenantId, p.serviceId],
      )
      const svc = rows[0]
      if (!svc || (svc.modality !== 'telehealth' && svc.modality !== 'hybrid')) return

      // De-dupe: skip if a room already exists for this booking.
      const existing = await repo.findRoomByBookingId(c, ctx.appId, ctx.tenantId, p.bookingId)
      if (existing) return

      const stub = provisionRoomStub({ bookingId: p.bookingId })
      const expiresAt = new Date(new Date(p.endsAt).getTime() + ROOM_GRACE_MINUTES * 60_000).toISOString()
      const room = await repo.insertRoom(c, ctx.appId, ctx.tenantId, {
        bookingId: p.bookingId, ...stub,
        status: 'created', startsAt: p.startsAt, endsAt: p.endsAt, expiresAt,
      })
      await publish({
        type: 'telehealth.room.created',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId,
          roomId: room.id, bookingId: p.bookingId, joinUrl: room.join_url,
          startsAt: p.startsAt, endsAt: p.endsAt,
        },
      })
    })
  } catch (err) {
    logger.warn({ err, type: event.type }, 'telehealth event handler error')
  }
}

export { subscribe }
