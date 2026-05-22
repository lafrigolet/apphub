// payment.service — listPayments cursor pagination + getPayment.
// Foco en lo NO cubierto por checkout-session/idempotency/refunds tests:
//
// listPayments:
//   - Pide al repo LIMIT+1; si recibió > limit → hasMore=true + slice los primeros LIMIT.
//   - cursor = id del último row del slice (o null si !hasMore).
//   - Pool client siempre se libera (incluso si repo lanza).
//
// getPayment:
//   - Delega 1:1 al repo (sin transformaciones).
//   - Libera client incluso si repo lanza.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    SPLITPAY_STRIPE_SECRET_KEY: 'sk_test',
    SPLITPAY_STRIPE_WEBHOOK_SECRET: 'whsec',
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const fakeClient = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
}))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('../lib/stripe.js', () => ({
  stripe: { paymentIntents: {}, refunds: {}, transfers: {} },
}))
vi.mock('../repositories/payment.repository.js')
vi.mock('../repositories/split-rule.repository.js')

import { getPayment, listPayments } from '../services/payment.service.js'
import * as paymentRepo from '../repositories/payment.repository.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  fakeClient.release.mockClear()
})

// ── getPayment ──────────────────────────────────────────────────────

describe('getPayment', () => {
  it('delega al repo y devuelve el row', async () => {
    paymentRepo.findPaymentById.mockResolvedValue({ id: 'pay-1', amount: 5000 })
    const r = await getPayment(ctx, 'pay-1')
    expect(paymentRepo.findPaymentById).toHaveBeenCalledWith(fakeClient, ctx, 'pay-1')
    expect(r.id).toBe('pay-1')
  })

  it('libera el client incluso si el repo lanza', async () => {
    paymentRepo.findPaymentById.mockRejectedValue(new Error('DB down'))
    await expect(getPayment(ctx, 'pay-1')).rejects.toThrow('DB down')
    expect(fakeClient.release).toHaveBeenCalled()
  })
})

// ── listPayments — cursor pagination ───────────────────────────────

describe('listPayments — cursor pagination', () => {
  it('pide LIMIT+1 al repo (sentinel para detectar hasMore)', async () => {
    paymentRepo.listPayments.mockResolvedValue([])
    await listPayments(ctx, 20)
    expect(paymentRepo.listPayments).toHaveBeenCalledWith(fakeClient, ctx, 21, undefined)
  })

  it('repo devuelve exactamente limit rows → hasMore=false + cursor=null', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }))
    paymentRepo.listPayments.mockResolvedValue(rows)
    const r = await listPayments(ctx, 20)
    expect(r.hasMore).toBe(false)
    expect(r.cursor).toBeNull()
    expect(r.data).toHaveLength(20)
  })

  it('repo devuelve limit+1 → hasMore=true + slice los primeros LIMIT + cursor=último', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}` }))
    paymentRepo.listPayments.mockResolvedValue(rows)
    const r = await listPayments(ctx, 20)
    expect(r.hasMore).toBe(true)
    expect(r.data).toHaveLength(20)
    expect(r.data[r.data.length - 1].id).toBe('p19')
    expect(r.cursor).toBe('p19')                // último ID del slice
  })

  it('repo devuelve menos del limit → hasMore=false', async () => {
    paymentRepo.listPayments.mockResolvedValue([{ id: 'p0' }, { id: 'p1' }])
    const r = await listPayments(ctx, 20)
    expect(r.hasMore).toBe(false)
    expect(r.data).toHaveLength(2)
    expect(r.cursor).toBeNull()
  })

  it('limit default = 20', async () => {
    paymentRepo.listPayments.mockResolvedValue([])
    await listPayments(ctx)
    expect(paymentRepo.listPayments).toHaveBeenCalledWith(fakeClient, ctx, 21, undefined)
  })

  it('cursor del caller propaga al repo', async () => {
    paymentRepo.listPayments.mockResolvedValue([])
    await listPayments(ctx, 50, 'p100')
    expect(paymentRepo.listPayments).toHaveBeenCalledWith(fakeClient, ctx, 51, 'p100')
  })

  it('limit custom propaga al sentinel (limit+1)', async () => {
    paymentRepo.listPayments.mockResolvedValue([])
    await listPayments(ctx, 5)
    expect(paymentRepo.listPayments).toHaveBeenCalledWith(fakeClient, ctx, 6, undefined)
  })

  it('libera el client incluso si el repo lanza', async () => {
    paymentRepo.listPayments.mockRejectedValue(new Error('DB error'))
    await expect(listPayments(ctx, 20)).rejects.toThrow('DB error')
    expect(fakeClient.release).toHaveBeenCalled()
  })

  it('hasMore=true: cursor refleja el último ID del SLICE (no del repo)', async () => {
    // 25 rows con limit 10 → slice [0..9], cursor = id 9
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}` }))
    paymentRepo.listPayments.mockResolvedValue(rows)
    const r = await listPayments(ctx, 10)
    expect(r.data).toHaveLength(10)
    expect(r.cursor).toBe('p9')                       // último del slice
  })

  it('última página vacía (sin rows) → hasMore=false + cursor=null + data=[]', async () => {
    paymentRepo.listPayments.mockResolvedValue([])
    const r = await listPayments(ctx, 20)
    expect(r).toEqual({ data: [], cursor: null, hasMore: false })
  })
})
