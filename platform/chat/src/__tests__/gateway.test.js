import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' },
}))
vi.mock('../lib/jwt.js', () => ({ verifyToken: vi.fn() }))
vi.mock('../services/presence.service.js', () => ({
  heartbeat: vi.fn().mockResolvedValue({ transitioned: false }),
  broadcastPresence: vi.fn().mockResolvedValue(),
  setOffline: vi.fn().mockResolvedValue(),
  typing: vi.fn().mockResolvedValue(),
}))

import { createGateway } from '../ws/gateway.js'
import { verifyToken } from '../lib/jwt.js'
import * as presence from '../services/presence.service.js'

function fakeSocket() {
  const handlers = {}
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((ev, cb) => { handlers[ev] = cb }),
    emit: (ev, ...args) => handlers[ev]?.(...args),
  }
}

const IDENTITY = { userId: 'u1', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'user' }

beforeEach(() => vi.clearAllMocks())

describe('gateway.deliver', () => {
  it('routes frames only to sockets of the listed recipients', () => {
    const gw = createGateway({})
    const s1 = fakeSocket()
    const s2 = fakeSocket()
    gw.sockets.set('platform:t1:u1', new Set([s1]))
    gw.sockets.set('platform:t1:u2', new Set([s2]))
    gw.deliver({
      appId: 'platform', tenantId: 't1', conversationId: 'c1',
      type: 'message.created', payload: { message: { id: 'm1' } }, recipientUserIds: ['u2'],
    })
    expect(s2.send).toHaveBeenCalledTimes(1)
    expect(s1.send).not.toHaveBeenCalled()
    const sent = JSON.parse(s2.send.mock.calls[0][0])
    expect(sent).toMatchObject({ type: 'message.created', conversationId: 'c1' })
  })

  it('ignores frames with no recipients', () => {
    const gw = createGateway({})
    expect(() => gw.deliver({ recipientUserIds: [] })).not.toThrow()
  })
})

describe('gateway redis fan-out', () => {
  it('psubscribes to chat:rt:*:* and delivers on pmessage', async () => {
    const handlers = {}
    const sub = {
      psubscribe: vi.fn().mockResolvedValue(1),
      on: vi.fn((ev, cb) => { handlers[ev] = cb }),
      quit: vi.fn().mockResolvedValue(),
    }
    const redis = { duplicate: () => sub }
    const gw = createGateway({ redis })
    expect(sub.psubscribe).toHaveBeenCalledWith('chat:rt:*:*')

    const s = fakeSocket()
    gw.sockets.set('platform:t1:u9', new Set([s]))
    handlers.pmessage('chat:rt:*:*', 'chat:rt:platform:t1', JSON.stringify({
      appId: 'platform', tenantId: 't1', type: 'typing', payload: {}, recipientUserIds: ['u9'],
    }))
    expect(s.send).toHaveBeenCalled()
    handlers.pmessage('p', 'c', 'not-json') // tolerated
    await gw.close()
    expect(sub.quit).toHaveBeenCalled()
  })
})

describe('gateway handler', () => {
  it('closes with 4401 on an invalid token', async () => {
    verifyToken.mockImplementation(() => { throw new Error('bad') })
    const gw = createGateway({})
    const socket = fakeSocket()
    const fastify = { get: vi.fn() }
    gw.registerRoutes(fastify)
    const handler = fastify.get.mock.calls[0][2]
    await handler(socket, { query: { token: 'x' }, headers: {} })
    expect(socket.close).toHaveBeenCalledWith(4401, 'unauthorized')
  })

  it('registers an authed socket, handles inbound frames, cleans up on close', async () => {
    verifyToken.mockReturnValue(IDENTITY)
    const gw = createGateway({})
    const fastify = { get: vi.fn() }
    gw.registerRoutes(fastify)
    const handler = fastify.get.mock.calls[0][2]
    const socket = fakeSocket()

    await handler(socket, { query: { token: 'good' }, headers: {} })
    expect(gw.sockets.get('platform:t1:u1').has(socket)).toBe(true)
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('connected'))

    await socket.emit('message', Buffer.from(JSON.stringify({ type: 'typing.start', conversationId: 'c1' })))
    expect(presence.typing).toHaveBeenCalledWith(IDENTITY, 'c1', true)
    await socket.emit('message', JSON.stringify({ type: 'typing.stop', conversationId: 'c1' }))
    expect(presence.typing).toHaveBeenCalledWith(IDENTITY, 'c1', false)
    await socket.emit('message', JSON.stringify({ type: 'presence.ping' }))
    expect(presence.heartbeat).toHaveBeenCalled()
    await socket.emit('message', 'garbage') // tolerated

    await socket.emit('close')
    expect(gw.sockets.has('platform:t1:u1')).toBe(false)
    expect(presence.setOffline).toHaveBeenCalledWith(IDENTITY)
  })

  it('reads the token from Sec-WebSocket-Protocol when no query token', async () => {
    verifyToken.mockReturnValue(IDENTITY)
    const gw = createGateway({})
    const fastify = { get: vi.fn() }
    gw.registerRoutes(fastify)
    const handler = fastify.get.mock.calls[0][2]
    const socket = fakeSocket()
    await handler(socket, { query: {}, headers: { 'sec-websocket-protocol': 'tok123, foo' } })
    expect(verifyToken).toHaveBeenCalledWith('tok123')
  })
})
