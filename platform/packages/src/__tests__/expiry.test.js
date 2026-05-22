// packages.purchase + redeem: cómputo del expiresAt + bloqueo de redenciones
// cuando el template está inactivo. Foco en lo que NO cubre el test de
// balance-consume (que ya prueba decrementSessions y autorización).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/packages.repository.js')

import { purchase, getPurchase } from '../services/packages.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/packages.repository.js'

const ctx = {
  appId: 'wellness',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
  userId: 'user-1',
  role: 'user',
}

// 2026-05-22T10:00:00Z as base for deterministic expiry calc
const NOW = new Date('2026-05-22T10:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

afterEach(() => vi.useRealTimers())

// ── purchase — guards ───────────────────────────────────────────────

describe('purchase guards', () => {
  it('template inexistente → NotFoundError 404', async () => {
    repo.findTemplateById.mockResolvedValue(null)
    await expect(purchase(ctx, { templateId: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
    expect(repo.insertPurchase).not.toHaveBeenCalled()
  })

  it('template inactivo (archivado) → ConflictError 409', async () => {
    repo.findTemplateById.mockResolvedValue({
      id: 'tpl-1', is_active: false, validity_days: 30,
      total_sessions: 10, price_cents: 5000, currency: 'EUR',
    })
    await expect(purchase(ctx, { templateId: 'tpl-1' })).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('not active'),
    })
    expect(repo.insertPurchase).not.toHaveBeenCalled()
  })
})

// ── purchase — expiresAt computation ─────────────────────────────────

describe('purchase — expiresAt deriva de validity_days', () => {
  it('30 días → exactamente 30 × 24h sumados a NOW', async () => {
    repo.findTemplateById.mockResolvedValue({
      id: 'tpl-1', is_active: true, validity_days: 30,
      total_sessions: 10, price_cents: 5000, currency: 'EUR',
    })
    repo.insertPurchase.mockResolvedValue({
      id: 'pkg-1', client_user_id: 'user-1', service_id: 'svc-1',
      total_sessions: 10, expires_at: '2026-06-21T10:00:00Z',
    })
    await purchase(ctx, { templateId: 'tpl-1' })
    const insertedArgs = repo.insertPurchase.mock.calls[0][3]
    const expected = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    expect(insertedArgs.expiresAt).toBe(expected)
  })

  it('1 día → ahora + 24h exactos', async () => {
    repo.findTemplateById.mockResolvedValue({
      id: 'tpl-1', is_active: true, validity_days: 1,
      total_sessions: 1, price_cents: 1000, currency: 'EUR',
    })
    repo.insertPurchase.mockResolvedValue({ id: 'pkg-1' })
    await purchase(ctx, { templateId: 'tpl-1' })
    expect(repo.insertPurchase.mock.calls[0][3].expiresAt).toBe('2026-05-23T10:00:00.000Z')
  })

  it('365 días → un año exacto (no calendar, sino 365×24h)', async () => {
    repo.findTemplateById.mockResolvedValue({
      id: 'tpl-1', is_active: true, validity_days: 365,
      total_sessions: 50, price_cents: 30000, currency: 'EUR',
    })
    repo.insertPurchase.mockResolvedValue({ id: 'pkg-1' })
    await purchase(ctx, { templateId: 'tpl-1' })
    const expected = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
    expect(repo.insertPurchase.mock.calls[0][3].expiresAt).toBe(expected)
  })
})

// ── purchase — pricePaidCents override + metadata + clientUserId ───

describe('purchase — overrides', () => {
  beforeEach(() => {
    repo.findTemplateById.mockResolvedValue({
      id: 'tpl-1', is_active: true, validity_days: 30,
      total_sessions: 10, price_cents: 5000, currency: 'EUR', service_id: 'svc-1',
    })
    repo.insertPurchase.mockResolvedValue({
      id: 'pkg-1', client_user_id: 'user-1', service_id: 'svc-1',
      total_sessions: 10, expires_at: 'x',
    })
  })

  it('pricePaidCents override > 0 sobrescribe el price_cents del template', async () => {
    await purchase(ctx, { templateId: 'tpl-1', pricePaidCents: 3000 })
    expect(repo.insertPurchase.mock.calls[0][3].pricePaidCents).toBe(3000)
  })

  it('pricePaidCents ausente → usa price_cents del template', async () => {
    await purchase(ctx, { templateId: 'tpl-1' })
    expect(repo.insertPurchase.mock.calls[0][3].pricePaidCents).toBe(5000)
  })

  it('clientUserId del body sobreescribe ctx.userId (regalos a otro user)', async () => {
    await purchase(ctx, { templateId: 'tpl-1', clientUserId: 'gift-recipient' })
    expect(repo.insertPurchase.mock.calls[0][3].clientUserId).toBe('gift-recipient')
  })

  it('clientUserId ausente → fallback a ctx.userId', async () => {
    await purchase(ctx, { templateId: 'tpl-1' })
    expect(repo.insertPurchase.mock.calls[0][3].clientUserId).toBe(ctx.userId)
  })

  it('remainingSessions === totalSessions en momento de purchase', async () => {
    await purchase(ctx, { templateId: 'tpl-1' })
    const args = repo.insertPurchase.mock.calls[0][3]
    expect(args.totalSessions).toBe(10)
    expect(args.remainingSessions).toBe(10)
  })

  it('publica package.purchased con totalSessions + expiresAt', async () => {
    await purchase(ctx, { templateId: 'tpl-1' })
    expect(publish).toHaveBeenCalledWith({
      type: 'package.purchased',
      payload: expect.objectContaining({
        packageId: 'pkg-1', clientUserId: 'user-1', serviceId: 'svc-1',
        totalSessions: 10, expiresAt: 'x',
      }),
    })
  })
})

// ── getPurchase — 404 + incluye redemptions ─────────────────────────

describe('getPurchase', () => {
  it('package inexistente → NotFoundError', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(getPurchase(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('hapy: incluye redemptions inline', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: 'pkg-1', remaining_sessions: 5 })
    repo.listRedemptions.mockResolvedValue([{ id: 'r1', delta: -1 }])
    const r = await getPurchase(ctx, 'pkg-1')
    expect(r.id).toBe('pkg-1')
    expect(r.redemptions).toHaveLength(1)
  })
})
