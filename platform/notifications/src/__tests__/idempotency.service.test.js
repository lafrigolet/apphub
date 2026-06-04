import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const redisMock = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: redisMock }))

import { claimEvent, eventKey } from '../services/idempotency.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.set.mockResolvedValue('OK')
})

describe('eventKey', () => {
  it('uses explicit idempotencyKey when present', () => {
    expect(eventKey({ type: 'order.paid', idempotencyKey: 'abc' })).toBe('order.paid:abc')
  })
  it('falls back to event.id', () => {
    expect(eventKey({ type: 'order.paid', id: 'evt-1' })).toBe('order.paid:evt-1')
  })
  it('derives a stable hash from type+payload when no explicit key', () => {
    const a = eventKey({ type: 'order.paid', payload: { orderId: 1 } })
    const b = eventKey({ type: 'order.paid', payload: { orderId: 1 } })
    const c = eventKey({ type: 'order.paid', payload: { orderId: 2 } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('order.paid:')).toBe(true)
  })
})

describe('claimEvent', () => {
  it('returns true on first claim (SET NX → OK)', async () => {
    const r = await claimEvent({ type: 'order.paid', id: 'e1' })
    expect(r).toBe(true)
    expect(redisMock.set).toHaveBeenCalledWith(
      'ndedup:order.paid:e1', '1', 'EX', 24 * 60 * 60, 'NX',
    )
  })

  it('returns false on duplicate (SET NX → null)', async () => {
    redisMock.set.mockResolvedValue(null)
    const r = await claimEvent({ type: 'order.paid', id: 'e1' })
    expect(r).toBe(false)
    expect(logger.info).toHaveBeenCalled()
  })

  it('honours a custom TTL', async () => {
    await claimEvent({ type: 'x', id: 'y' }, 60)
    expect(redisMock.set).toHaveBeenCalledWith('ndedup:x:y', '1', 'EX', 60, 'NX')
  })

  it('fails open (returns true) when Redis throws', async () => {
    redisMock.set.mockRejectedValue(new Error('redis down'))
    const r = await claimEvent({ type: 'order.paid', id: 'e1' })
    expect(r).toBe(true)
    expect(logger.warn).toHaveBeenCalled()
  })
})
