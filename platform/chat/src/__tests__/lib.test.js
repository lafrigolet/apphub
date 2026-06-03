import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', PLATFORM_JWT_SECRET: undefined },
}))

import { redactPii } from '../lib/redact.js'
import { rtChannel, PLATFORM_EVENTS_CHANNEL, configureRedis, getRedis, publishPlatformEvent, publishRealtime } from '../lib/redis.js'
import { enforceRate } from '../lib/ratelimit.js'
import { isStaff, ensureParticipant, ensureManager, requireStaff, ensureFound } from '../services/guards.js'

// ── redact ──────────────────────────────────────────────────────────────
describe('redactPii', () => {
  it('masks emails', () => {
    expect(redactPii('reach me at a@b.com')).toBe('reach me at [email oculto]')
  })
  it('masks phone numbers with >=9 digits', () => {
    expect(redactPii('call +34 600 123 456')).toContain('[teléfono oculto]')
  })
  it('leaves short digit runs alone', () => {
    expect(redactPii('tengo 3 gatos')).toBe('tengo 3 gatos')
  })
  it('passes through null', () => {
    expect(redactPii(null)).toBeNull()
  })
})

// ── redis helpers ─────────────────────────────────────────────────────────
describe('redis helpers', () => {
  it('rtChannel builds the namespaced channel', () => {
    expect(rtChannel('platform', 't1')).toBe('chat:rt:platform:t1')
    expect(PLATFORM_EVENTS_CHANNEL).toBe('platform.events')
  })

  it('publishers are no-ops without a configured redis', async () => {
    configureRedis(null)
    expect(getRedis()).toBeNull()
    await expect(publishPlatformEvent('x', {})).resolves.toBeUndefined()
    await expect(publishRealtime('a', 't', {})).resolves.toBeUndefined()
  })

  it('publishPlatformEvent publishes to the bus and swallows errors', async () => {
    const ok = { publish: vi.fn().mockResolvedValue(1) }
    configureRedis(ok)
    await publishPlatformEvent('chat.message.created', { a: 1 })
    expect(ok.publish).toHaveBeenCalledWith('platform.events', expect.stringContaining('chat.message.created'))

    const bad = { publish: vi.fn().mockRejectedValue(new Error('down')) }
    configureRedis(bad)
    await expect(publishRealtime('a', 't', { type: 'x' })).resolves.toBeUndefined()
    configureRedis(null)
  })
})

// ── ratelimit ──────────────────────────────────────────────────────────────
describe('enforceRate', () => {
  it('no-op when redis missing', async () => {
    configureRedis(null)
    await expect(enforceRate('k', 1, 10)).resolves.toBeUndefined()
  })
  it('sets expiry on first hit and throws 429 over the cap', async () => {
    const redis = { incr: vi.fn(), expire: vi.fn().mockResolvedValue(1) }
    configureRedis(redis)
    redis.incr.mockResolvedValueOnce(1)
    await enforceRate('k', 2, 10)
    expect(redis.expire).toHaveBeenCalledWith('k', 10)
    redis.incr.mockResolvedValueOnce(3)
    await expect(enforceRate('k', 2, 10)).rejects.toMatchObject({ statusCode: 429 })
    configureRedis(null)
  })
})

// ── guards ──────────────────────────────────────────────────────────────────
describe('guards', () => {
  const staff = { role: 'staff' }
  const user = { role: 'user' }

  it('isStaff', () => {
    expect(isStaff(staff)).toBe(true)
    expect(isStaff(user)).toBe(false)
  })

  it('ensureParticipant: staff bypass, active ok, missing/left → 403', () => {
    expect(() => ensureParticipant(null, staff)).not.toThrow()
    expect(() => ensureParticipant({ role: 'member' }, user)).not.toThrow()
    expect(() => ensureParticipant(null, user)).toThrow()
    expect(() => ensureParticipant({ left_at: '2026-01-01' }, user)).toThrow()
  })

  it('ensureManager: staff bypass, owner/admin ok, member → 403', () => {
    expect(() => ensureManager(null, staff)).not.toThrow()
    expect(() => ensureManager({ role: 'owner' }, user)).not.toThrow()
    expect(() => ensureManager({ role: 'admin' }, user)).not.toThrow()
    expect(() => ensureManager({ role: 'member' }, user)).toThrow()
    expect(() => ensureManager(null, user)).toThrow()
  })

  it('requireStaff', () => {
    expect(() => requireStaff(staff)).not.toThrow()
    expect(() => requireStaff(user)).toThrow()
  })

  it('ensureFound returns row or throws 404', () => {
    expect(ensureFound({ id: 1 }, 'X')).toEqual({ id: 1 })
    expect(() => ensureFound(null, 'X')).toThrow()
  })
})
