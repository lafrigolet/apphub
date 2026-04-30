import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://l',
    PLATFORM_MARKETPLACE_URL: 'http://localhost:3100',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { fetchOrder, isVerifiedPurchase } from '../lib/orders-client.js'

const ORDER_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID  = '22222222-2222-2222-2222-222222222222'
const JWT      = 'fake.jwt.token'

let originalFetch
beforeEach(() => {
  originalFetch = global.fetch
  global.fetch = vi.fn()
})
afterEach(() => {
  global.fetch = originalFetch
})

// ── fetchOrder ────────────────────────────────────────────────────────
describe('fetchOrder', () => {
  it('returns null when orderId is missing', async () => {
    expect(await fetchOrder(null, JWT)).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns null when jwt is missing', async () => {
    expect(await fetchOrder(ORDER_ID, null)).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns null on 404', async () => {
    global.fetch.mockResolvedValue({ status: 404, ok: false })
    expect(await fetchOrder(ORDER_ID, JWT)).toBeNull()
  })

  it('returns null on 500 (soft-fail)', async () => {
    global.fetch.mockResolvedValue({ status: 500, ok: false })
    expect(await fetchOrder(ORDER_ID, JWT)).toBeNull()
  })

  it('returns null on network error (soft-fail)', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await fetchOrder(ORDER_ID, JWT)).toBeNull()
  })

  it('returns parsed JSON on 200', async () => {
    const order = { id: ORDER_ID, buyer_user_id: USER_ID, status: 'paid' }
    global.fetch.mockResolvedValue({ status: 200, ok: true, json: async () => order })
    expect(await fetchOrder(ORDER_ID, JWT)).toEqual(order)
  })

  it('sends Bearer token in Authorization header', async () => {
    global.fetch.mockResolvedValue({ status: 200, ok: true, json: async () => ({}) })
    await fetchOrder(ORDER_ID, JWT)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3100/api/orders/' + ORDER_ID,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${JWT}` },
      }),
    )
  })
})

// ── isVerifiedPurchase ───────────────────────────────────────────────
describe('isVerifiedPurchase', () => {
  it('returns false when orderId missing', async () => {
    expect(await isVerifiedPurchase(null, USER_ID, JWT)).toBe(false)
  })

  it('returns false when buyerUserId missing', async () => {
    expect(await isVerifiedPurchase(ORDER_ID, null, JWT)).toBe(false)
  })

  it('returns false when jwt missing', async () => {
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, null)).toBe(false)
  })

  it('returns false when fetch returns null', async () => {
    global.fetch.mockResolvedValue({ status: 404, ok: false })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(false)
  })

  it('returns false when buyer mismatches', async () => {
    global.fetch.mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: 'someone-else', status: 'paid' }),
    })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(false)
  })

  it('returns false when status is pending', async () => {
    global.fetch.mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: USER_ID, status: 'pending' }),
    })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(false)
  })

  it('returns false when status is cancelled', async () => {
    global.fetch.mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: USER_ID, status: 'cancelled' }),
    })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(false)
  })

  it('returns true on paid + matching buyer', async () => {
    global.fetch.mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: USER_ID, status: 'paid' }),
    })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(true)
  })

  it('accepts delivered status', async () => {
    global.fetch.mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: USER_ID, status: 'delivered' }),
    })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(true)
  })

  it('accepts completed status', async () => {
    global.fetch.mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: USER_ID, status: 'completed' }),
    })
    expect(await isVerifiedPurchase(ORDER_ID, USER_ID, JWT)).toBe(true)
  })
})
