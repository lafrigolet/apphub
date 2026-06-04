import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
const withTenantTransaction = vi.hoisted(() => vi.fn(async (_p, _a, _t, _s, fn) => fn(client)))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(client) },
  withTenantTransaction,
}))

const repo = vi.hoisted(() => ({ isMutedFor: vi.fn(), upsertToken: vi.fn() }))
vi.mock('../repositories/preferences.repository.js', () => repo)

import { categoryForEvent, isMuted, ensureUnsubscribeToken, mintToken } from '../services/preferences.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  repo.isMutedFor.mockResolvedValue(false)
})

describe('categoryForEvent', () => {
  it('maps known prefixes', () => {
    expect(categoryForEvent('booking.confirmed')).toBe('bookings')
    expect(categoryForEvent('order.paid')).toBe('orders')
    expect(categoryForEvent('donation.completed')).toBe('donations')
    expect(categoryForEvent('basket.abandoned')).toBe('marketing')
    expect(categoryForEvent('auth.signup.approved')).toBe('auth')
    expect(categoryForEvent('chat.message.created')).toBe('chat')
  })
  it('maps unknown to other', () => {
    expect(categoryForEvent('weird.thing')).toBe('other')
    expect(categoryForEvent(undefined)).toBe('other')
  })
})

describe('isMuted', () => {
  it('returns false without userId', async () => {
    expect(await isMuted({ eventType: 'order.paid', channel: 'email' })).toBe(false)
    expect(repo.isMutedFor).not.toHaveBeenCalled()
  })

  it('never mutes transactional (auth) categories regardless of context', async () => {
    const r = await isMuted({ userId: 'u1', eventType: 'auth.signup.approved', channel: 'email', appId: 'a', tenantId: 't' })
    expect(r).toBe(false)
    expect(repo.isMutedFor).not.toHaveBeenCalled()
  })

  it('fails open (false) when tenant context missing', async () => {
    const r = await isMuted({ userId: 'u1', eventType: 'order.paid', channel: 'email' })
    expect(r).toBe(false)
    expect(repo.isMutedFor).not.toHaveBeenCalled()
  })

  it('consults the repo when context present', async () => {
    repo.isMutedFor.mockResolvedValue(true)
    const r = await isMuted({ userId: 'u1', eventType: 'order.paid', channel: 'email', appId: 'a', tenantId: 't' })
    expect(r).toBe(true)
    expect(repo.isMutedFor).toHaveBeenCalledWith(client, { userId: 'u1', category: 'orders', channel: 'email' })
  })

  it('fails open when the repo throws', async () => {
    repo.isMutedFor.mockRejectedValue(new Error('boom'))
    const r = await isMuted({ userId: 'u1', eventType: 'order.paid', channel: 'email', appId: 'a', tenantId: 't' })
    expect(r).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('mintToken / ensureUnsubscribeToken', () => {
  it('mints a url-safe token', () => {
    const t = mintToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(t.length).toBeGreaterThan(20)
  })

  it('delegates to repo.upsertToken and releases', async () => {
    repo.upsertToken.mockResolvedValue('tok-123')
    const t = await ensureUnsubscribeToken({ appId: 'a', tenantId: 't', userId: 'u1' })
    expect(t).toBe('tok-123')
    expect(client.release).toHaveBeenCalled()
  })
})
