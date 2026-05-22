// platform-sdk/redis — helpers de publish/subscribe sobre ioredis.
// Contrato:
//   - createRedis(url): retorna ioredis.Redis con opts canónicas (maxRetries=3,
//     enableReadyCheck=true, lazyConnect=false).
//   - publish(redis, appId, event):
//       · Canal = `<appId>.events`.
//       · Body = JSON.stringify(event).
//       · Si event tiene refs cíclicas → propaga el TypeError.
//   - subscribe(url, appId, onMessage):
//       · Crea un NUEVO ioredis (separado del pub).
//       · SUBSCRIBE al canal `<appId>.events`.
//       · Registra onMessage handler.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisCtorMock, instances } = vi.hoisted(() => {
  const created = []
  return {
    instances: created,
    redisCtorMock: vi.fn().mockImplementation(function (url, opts) {
      this.url = url
      this.opts = opts
      this.publish = vi.fn().mockResolvedValue(1)
      this.subscribe = vi.fn((_chan, cb) => cb && cb(null))
      this.on = vi.fn()
      this.quit = vi.fn().mockResolvedValue(undefined)
      created.push(this)
    }),
  }
})

vi.mock('ioredis', () => ({ default: redisCtorMock }))

import { createRedis, publish, subscribe } from '../redis.js'

beforeEach(() => {
  vi.clearAllMocks()
  instances.length = 0
})

// ── createRedis ─────────────────────────────────────────────────────

describe('createRedis', () => {
  it('construye Redis con maxRetriesPerRequest=3, enableReadyCheck=true, lazyConnect=false', () => {
    createRedis('redis://localhost:6379')
    expect(redisCtorMock).toHaveBeenCalledWith('redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    })
  })

  it('cada llamada crea una nueva instancia (no singleton)', () => {
    createRedis('redis://a')
    createRedis('redis://b')
    expect(instances).toHaveLength(2)
    expect(instances[0].url).toBe('redis://a')
    expect(instances[1].url).toBe('redis://b')
  })
})

// ── publish ─────────────────────────────────────────────────────────

describe('publish', () => {
  it('canal = "<appId>.events" + body JSON.stringify', async () => {
    const redis = createRedis('redis://x')
    await publish(redis, 'aikikan', { type: 'test', payload: { x: 1 } })
    expect(redis.publish).toHaveBeenCalledWith(
      'aikikan.events',
      JSON.stringify({ type: 'test', payload: { x: 1 } }),
    )
  })

  it('appId distinto → canal distinto (no cross-app leakage)', async () => {
    const redis = createRedis('redis://x')
    await publish(redis, 'aulavera', { type: 'a' })
    await publish(redis, 'aikikan', { type: 'b' })
    expect(redis.publish.mock.calls[0][0]).toBe('aulavera.events')
    expect(redis.publish.mock.calls[1][0]).toBe('aikikan.events')
  })

  it('event con refs cíclicas → propaga TypeError de JSON.stringify', async () => {
    const redis = createRedis('redis://x')
    const cyclic = {}
    cyclic.self = cyclic
    await expect(publish(redis, 'a', cyclic)).rejects.toThrow(TypeError)
  })

  it('payload con caracteres unicode/emoji → JSON-safe', async () => {
    const redis = createRedis('redis://x')
    await publish(redis, 'a', { msg: 'héllo 🚀' })
    expect(redis.publish.mock.calls[0][1]).toContain('héllo')
  })
})

// ── subscribe ───────────────────────────────────────────────────────

describe('subscribe', () => {
  it('crea NUEVO cliente Redis (separado del publisher)', () => {
    subscribe('redis://x', 'a', () => {})
    // ctor llamado 1 vez exacta (el client del subscribe; no se reusa)
    expect(redisCtorMock).toHaveBeenCalledTimes(1)
  })

  it('SUBSCRIBE al canal "<appId>.events"', () => {
    subscribe('redis://x', 'aikikan', () => {})
    expect(instances[0].subscribe).toHaveBeenCalledWith('aikikan.events', expect.any(Function))
  })

  it('registra el handler "message" del callback', () => {
    const handler = vi.fn()
    subscribe('redis://x', 'a', handler)
    expect(instances[0].on).toHaveBeenCalledWith('message', handler)
  })

  it('retorna el subscriber para que el caller pueda hacer .quit()', () => {
    const sub = subscribe('redis://x', 'a', () => {})
    expect(sub).toBe(instances[0])
    expect(typeof sub.quit).toBe('function')
  })

  it('subscribe error → console.error pero NO throw (no rompe el boot)', () => {
    instances.length = 0
    redisCtorMock.mockImplementationOnce(function () {
      this.subscribe = vi.fn((_chan, cb) => cb(new Error('connection refused')))
      this.on = vi.fn()
      instances.push(this)
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => subscribe('redis://x', 'a', () => {})).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
