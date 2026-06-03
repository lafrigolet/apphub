import { publishRealtime, publishPlatformEvent } from '../lib/redis.js'

// Real-time fan-out. The service layer calls emit() after a write commits; the
// frame is published to the tenant's rt channel and every platform-core
// instance's WS gateway delivers it to the locally-connected sockets whose
// user is in `recipientUserIds`. This is what makes delivery work
// browser-to-browser across replicas.
//
// frame = { conversationId, type, payload }
export async function emit(ctx, recipientUserIds, frame) {
  await publishRealtime(ctx.appId, ctx.tenantId, {
    v: 1,
    appId: ctx.appId,
    tenantId: ctx.tenantId,
    conversationId: frame.conversationId,
    type: frame.type,
    payload: frame.payload,
    recipientUserIds: recipientUserIds ?? [],
  })
}

// Business event on the platform bus (consumed by notifications for offline
// push / email). Best-effort — never throws.
export async function notify(type, payload) {
  await publishPlatformEvent(type, payload)
}
