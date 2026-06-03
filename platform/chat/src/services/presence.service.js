import { withTenantTransaction } from '../lib/db.js'
import { getRedis } from '../lib/redis.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as realtime from './realtime.service.js'
import { ensureParticipant } from './guards.js'

const ONLINE_TTL = 60   // seconds — refreshed by heartbeat frames
const TYPING_TTL = 6     // seconds

function presenceKey(appId, tenantId, userId) {
  return `chat:presence:${appId}:${tenantId}:${userId}`
}
function typingKey(appId, tenantId, conversationId) {
  return `chat:typing:${appId}:${tenantId}:${conversationId}`
}

// Refresh/raise the caller's presence. Returns whether this was a transition
// from offline → online (so the gateway only broadcasts on real transitions).
export async function heartbeat(ctx, status = 'online') {
  const redis = getRedis()
  if (!redis) return { transitioned: false }
  const key = presenceKey(ctx.appId, ctx.tenantId, ctx.userId)
  const was = await redis.get(key)
  await redis.set(key, status, 'EX', ONLINE_TTL)
  return { transitioned: was !== status }
}

export async function setOffline(ctx) {
  const redis = getRedis()
  if (!redis) return
  await redis.del(presenceKey(ctx.appId, ctx.tenantId, ctx.userId))
}

// Presence snapshot for a set of users (missing key ⇒ offline).
export async function snapshot(ctx, userIds) {
  const redis = getRedis()
  const ids = [...new Set(userIds ?? [])]
  if (!redis || !ids.length) return ids.map((userId) => ({ userId, status: 'offline' }))
  const keys = ids.map((u) => presenceKey(ctx.appId, ctx.tenantId, u))
  const vals = await redis.mget(keys)
  return ids.map((userId, i) => ({ userId, status: vals[i] ?? 'offline' }))
}

// Broadcast a presence transition to everyone who shares a conversation with
// the caller. Called by the gateway on connect/disconnect.
export async function broadcastPresence(ctx, status) {
  const recipients = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    partRepo.coParticipantUserIds(c, ctx.userId),
  )
  if (!recipients.length) return
  await realtime.emit(ctx, recipients, {
    conversationId: null, type: 'presence', payload: { userId: ctx.userId, status },
  })
}

// Typing indicator within a conversation. Verifies the caller is a participant,
// writes an ephemeral typing key, and fans the indicator out to co-participants.
export async function typing(ctx, conversationId, isTyping) {
  const redis = getRedis()
  const recipients = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    const participants = await partRepo.list(c, conversationId)
    return participants.filter((p) => p.user_id !== ctx.userId).map((p) => p.user_id)
  })
  if (redis) {
    const key = typingKey(ctx.appId, ctx.tenantId, conversationId)
    if (isTyping) await redis.set(`${key}:${ctx.userId}`, '1', 'EX', TYPING_TTL)
    else await redis.del(`${key}:${ctx.userId}`)
  }
  await realtime.emit(ctx, recipients, {
    conversationId, type: 'typing', payload: { userId: ctx.userId, isTyping: !!isTyping },
  })
}
