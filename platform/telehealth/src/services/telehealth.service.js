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

export async function endRoom(ctx, id) {
  const room = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.setRoomStatus(c, ctx.appId, ctx.tenantId, id, 'ended'),
  )
  if (!room) throw new NotFoundError('room')
  await publish({
    type: 'telehealth.room.ended',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, roomId: id, bookingId: room.booking_id },
  })
  return room
}

export async function cancelRoom(ctx, id) {
  const room = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.setRoomStatus(c, ctx.appId, ctx.tenantId, id, 'cancelled'),
  )
  if (!room) throw new NotFoundError('room')
  return room
}

// Auto-provision a room when a telehealth booking is confirmed.
export async function handleEvent(event) {
  try {
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
