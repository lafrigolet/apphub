// rate-limit.service — Redis-counter based per-user limiting.
// Contrato:
//   - Sin userId → { allowed: true, reason: 'no-user' } (no rate-limit anonymous).
//   - Lee config (rate_limit_per_user_per_hour, _per_day) con cache 30s.
//   - Increment atómico vía MULTI: hourKey + dayKey con TTL = window + slack.
//   - Si excede hour limit → allowed=false, reason='hour', decr rollback.
//   - Si excede day limit (no hour) → allowed=false, reason='day'.
//   - Si limit es null/empty/0/negativo → unlimited (incrementa pero no chequea).
//   - Buckets: hour = "YYYY-MM-DDTHH" UTC; day = "YYYY-MM-DD" UTC.
//   - Hour TTL = 3600+60; day TTL = 86400+600 (slack para clock skew).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const fakeRedis = vi.hoisted(() => ({
  incr: vi.fn(),
  decr: vi.fn().mockResolvedValue(0),
  expire: vi.fn(),
  multi: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ redis: fakeRedis }))
const fakeClient = vi.hoisted(() => ({ release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
}))
const configRepoMock = vi.hoisted(() => ({ getValue: vi.fn() }))
vi.mock('../repositories/config.repository.js', () => configRepoMock)

import { checkRateLimit, invalidateRateLimitCache } from '../services/rate-limit.service.js'

function setupMulti(hourCount, dayCount) {
  // pipe.incr(...).expire(...).incr(...).expire(...)
  // exec returns [[err, val], ...] at indexes [incr-hour, expire, incr-day, expire]
  const pipe = {
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([
      [null, hourCount],   // incr hour
      [null, 1],           // expire
      [null, dayCount],    // incr day
      [null, 1],           // expire
    ]),
  }
  fakeRedis.multi.mockReturnValue(pipe)
  return pipe
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateRateLimitCache()
})

// ── no-user (anonymous) ────────────────────────────────────────────

describe('userId ausente', () => {
  it('sin userId → allowed=true sin tocar Redis', async () => {
    const r = await checkRateLimit({ userId: null, eventClass: 'reminder', channel: 'email' })
    expect(r).toEqual({ allowed: true, reason: 'no-user' })
    expect(fakeRedis.multi).not.toHaveBeenCalled()
  })
})

// ── Bajo el límite ──────────────────────────────────────────────────

describe('bajo el límite', () => {
  it('hourCount < hour limit + dayCount < day limit → allowed=true', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('5')      // hour
      .mockResolvedValueOnce('50')     // day
    setupMulti(2, 10)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.allowed).toBe(true)
    expect(r.current).toEqual({ hour: 2, day: 10 })
    expect(r.limits).toMatchObject({ hour: 5, day: 50 })
    expect(fakeRedis.decr).not.toHaveBeenCalled()
  })

  it('limit hour ausente (null) → unlimited en esa ventana', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce(null)      // hour = unlimited
      .mockResolvedValueOnce('50')
    setupMulti(100, 10)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.allowed).toBe(true)
    expect(r.limits.hour).toBeNull()
  })

  it('limit "0" o "-5" o "" → null (unlimited)', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('-5')
    setupMulti(100, 100)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.limits).toMatchObject({ hour: null, day: null })
    expect(r.allowed).toBe(true)
  })
})

// ── Exceeded ─────────────────────────────────────────────────────────

describe('límite excedido', () => {
  it('hourCount > hour limit → allowed=false, reason="hour", rollback decr en hourKey', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('50')
    setupMulti(6, 10)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('hour')
    expect(fakeRedis.decr).toHaveBeenCalledWith(expect.stringMatching(/^nrl:h:/))
  })

  it('dayCount > day limit (hour OK) → reason="day"', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('20')
    setupMulti(5, 21)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('day')
    expect(fakeRedis.decr).toHaveBeenCalledWith(expect.stringMatching(/^nrl:d:/))
  })

  it('AMBOS excedidos → reason="hour" (hour precede); decrementa ambos counters', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('20')
    setupMulti(6, 21)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.reason).toBe('hour')
    expect(fakeRedis.decr).toHaveBeenCalledTimes(2)
  })

  it('current.hour refleja el rollback (count - 1)', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('50')
    setupMulti(6, 10)
    const r = await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(r.current).toEqual({ hour: 5, day: 10 })   // hour cuenta tras rollback
  })

  it('decr error es swallow (best-effort rollback)', async () => {
    configRepoMock.getValue
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('50')
    setupMulti(6, 10)
    fakeRedis.decr.mockRejectedValueOnce(new Error('redis down'))
    await expect(checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' }))
      .resolves.toBeDefined()
  })
})

// ── Key namespace ───────────────────────────────────────────────────

describe('Redis key namespace', () => {
  it('keys con prefijo nrl:h: y nrl:d: (anti-colisión con otras estructuras)', async () => {
    configRepoMock.getValue.mockResolvedValue('100')
    const pipe = setupMulti(1, 1)
    await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    expect(pipe.incr).toHaveBeenCalledWith(expect.stringMatching(/^nrl:h:u1:reminder:email:/))
    expect(pipe.incr).toHaveBeenCalledWith(expect.stringMatching(/^nrl:d:u1:reminder:email:/))
  })

  it('TTL ventana hour = 3660s, day = 87000s (con slack para clock skew)', async () => {
    configRepoMock.getValue.mockResolvedValue('100')
    const pipe = setupMulti(1, 1)
    await checkRateLimit({ userId: 'u1', eventClass: 'r', channel: 'e' })
    const expireCalls = pipe.expire.mock.calls
    const ttls = expireCalls.map((c) => c[1])
    expect(ttls).toContain(3660)
    expect(ttls).toContain(87000)
  })

  it('keys distintos para (userId, eventClass, channel) → namespacing correcto', async () => {
    configRepoMock.getValue.mockResolvedValue('100')
    const pipe1 = setupMulti(1, 1)
    await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'email' })
    const key1 = pipe1.incr.mock.calls[0][0]

    const pipe2 = setupMulti(1, 1)
    await checkRateLimit({ userId: 'u1', eventClass: 'reminder', channel: 'sms' })
    const key2 = pipe2.incr.mock.calls[0][0]
    expect(key1).not.toBe(key2)            // distinto channel → distinta key
  })
})
