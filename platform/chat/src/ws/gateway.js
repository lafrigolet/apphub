import { verifyToken } from '../lib/jwt.js'
import { rtChannel } from '../lib/redis.js'
import * as presence from '../services/presence.service.js'

// The chat WebSocket gateway. One instance per platform-core process.
//
//   • Browsers open `GET /v1/chat/ws?token=<jwt>` — the only auth channel a
//     browser has on a WS handshake (no Authorization header), so the token
//     rides the query string (or Sec-WebSocket-Protocol) and is verified here.
//   • Each socket is registered under `${appId}:${tenantId}:${userId}`.
//   • A duplicated Redis connection p-subscribes to `chat:rt:*`. When any
//     instance publishes an rt frame (after a write commits), every instance's
//     gateway delivers it to its locally-connected sockets whose user is in
//     `recipientUserIds`. That is what makes delivery work browser-to-browser
//     across replicas.
//   • Inbound client frames: `typing.start` / `typing.stop` / `presence.ping`.
//     Message *sending* goes through the REST POST, never the socket — one
//     auditable write path.
export function createGateway({ redis, logger } = {}) {
  const sockets = new Map() // key -> Set<socket>

  const key = (appId, tenantId, userId) => `${appId}:${tenantId}:${userId}`

  function addSocket(id, socket) {
    let set = sockets.get(id)
    if (!set) { set = new Set(); sockets.set(id, set) }
    set.add(socket)
  }
  function removeSocket(id, socket) {
    const set = sockets.get(id)
    if (!set) return
    set.delete(socket)
    if (set.size === 0) sockets.delete(id)
  }

  // Deliver an rt frame to locally-connected recipients.
  function deliver(frame) {
    if (!frame?.recipientUserIds?.length) return
    const data = JSON.stringify({ type: frame.type, conversationId: frame.conversationId, payload: frame.payload })
    for (const userId of frame.recipientUserIds) {
      const set = sockets.get(key(frame.appId, frame.tenantId, userId))
      if (!set) continue
      for (const s of set) {
        try { s.send(data) } catch { /* socket gone; close handler will clean up */ }
      }
    }
  }

  // Cross-instance fan-out subscriber (a dedicated connection — a subscriber
  // can't issue normal commands, so we duplicate the shared client).
  let sub = null
  if (redis && typeof redis.duplicate === 'function') {
    sub = redis.duplicate()
    sub.psubscribe(rtChannel('*', '*')).catch((err) => logger?.error?.({ err }, 'chat rt psubscribe failed'))
    sub.on('pmessage', (_pattern, _channel, message) => {
      let frame
      try { frame = JSON.parse(message) } catch { return }
      deliver(frame)
    })
  }

  function extractToken(req) {
    if (req.query?.token) return req.query.token
    const proto = req.headers['sec-websocket-protocol']
    if (proto) return proto.split(',')[0].trim()
    return null
  }

  async function handler(rawSocket, req) {
    // @fastify/websocket passes the WebSocket directly in v11; older shapes
    // wrap it in { socket }. Support both.
    const socket = rawSocket?.socket ?? rawSocket

    let ctx
    try {
      ctx = verifyToken(extractToken(req))
    } catch {
      try { socket.close(4401, 'unauthorized') } catch { /* already closed */ }
      return
    }

    const id = key(ctx.appId, ctx.tenantId, ctx.userId)
    addSocket(id, socket)
    try { socket.send(JSON.stringify({ type: 'connected', payload: { userId: ctx.userId } })) } catch { /* noop */ }

    presence.heartbeat(ctx)
      .then(({ transitioned }) => { if (transitioned) return presence.broadcastPresence(ctx, 'online') })
      .catch((err) => logger?.warn?.({ err }, 'presence online failed'))

    socket.on('message', async (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      try {
        switch (msg.type) {
          case 'typing.start': await presence.typing(ctx, msg.conversationId, true); break
          case 'typing.stop':  await presence.typing(ctx, msg.conversationId, false); break
          case 'presence.ping': await presence.heartbeat(ctx); break
          default: break // subscribe/unsubscribe are implicit (delivery is by participant)
        }
      } catch (err) {
        logger?.warn?.({ err, type: msg.type }, 'ws frame handling failed')
      }
    })

    socket.on('close', async () => {
      removeSocket(id, socket)
      if (!sockets.has(id)) {
        await presence.setOffline(ctx).catch(() => {})
        await presence.broadcastPresence(ctx, 'offline').catch(() => {})
      }
    })
  }

  function registerRoutes(fastify) {
    fastify.get('/ws', {
      websocket: true,
      config: { public: true },
      schema: { tags: ['chat'], summary: 'Real-time chat WebSocket gateway (auth via ?token= or Sec-WebSocket-Protocol)' },
    }, handler)
  }

  async function close() {
    if (sub) await sub.quit().catch(() => {})
  }

  return { registerRoutes, close, deliver, sockets }
}
