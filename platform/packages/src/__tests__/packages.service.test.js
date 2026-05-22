import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../repositories/packages.repository.js')

import * as service from '../services/packages.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/packages.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TPL_ID    = '11111111-1111-1111-1111-111111111111'
const PKG_ID    = '22222222-2222-2222-2222-222222222222'
const SVC_ID    = '33333333-3333-3333-3333-333333333333'
const USER_ID   = '44444444-4444-4444-4444-444444444444'
const BOOK_ID   = '55555555-5555-5555-5555-555555555555'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('templates / purchase', () => {
  it('createTemplate scopes', async () => {
    repo.insertTemplate.mockResolvedValue({ id: TPL_ID })
    await service.createTemplate(ctx, { code: 'P10', name: '10x', serviceId: SVC_ID, totalSessions: 10 })
    expect(repo.insertTemplate).toHaveBeenCalled()
  })

  it('purchase rejects when template not active', async () => {
    repo.findTemplateById.mockResolvedValue({ id: TPL_ID, is_active: false, service_id: SVC_ID })
    await expect(service.purchase(ctx, { templateId: TPL_ID })).rejects.toThrow(ConflictError)
  })

  it('purchase throws NotFoundError when template missing', async () => {
    repo.findTemplateById.mockResolvedValue(null)
    await expect(service.purchase(ctx, { templateId: TPL_ID })).rejects.toThrow(NotFoundError)
  })

  it('purchase computes expiresAt from validity_days and publishes package.purchased', async () => {
    repo.findTemplateById.mockResolvedValue({
      id: TPL_ID, is_active: true, service_id: SVC_ID,
      validity_days: 30, total_sessions: 10, price_cents: 40000, currency: 'EUR',
    })
    repo.insertPurchase.mockImplementation(async (_c, _a, _t, args) => ({
      id: PKG_ID, ...args, client_user_id: args.clientUserId, service_id: args.serviceId,
      total_sessions: args.totalSessions, expires_at: args.expiresAt,
    }))
    const before = Date.now()
    await service.purchase(ctx, { templateId: TPL_ID })
    const call = repo.insertPurchase.mock.calls[0][3]
    const expiresAt = new Date(call.expiresAt).getTime()
    expect(expiresAt).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000)
    expect(expiresAt).toBeLessThan(before + 31 * 24 * 60 * 60 * 1000)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.purchased' }))
  })
})

describe('getPurchase / listPurchases', () => {
  it('getPurchase returns package with redemptions', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, total_sessions: 10, remaining_sessions: 8 })
    repo.listRedemptions.mockResolvedValue([{ delta: -1 }, { delta: -1 }])
    const r = await service.getPurchase(ctx, PKG_ID)
    expect(r.redemptions).toHaveLength(2)
  })

  it('getPurchase throws NotFoundError when missing', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.getPurchase(ctx, PKG_ID)).rejects.toThrow(NotFoundError)
  })
})

describe('redeem / refund', () => {
  // ensureRedeemAllowed busca el package y compara client_user_id con ctx.userId.
  // Devolvemos un pkg cuyo dueño es USER_ID para que el caller pase el guard.
  beforeEach(() => {
    repo.findPurchaseById.mockResolvedValue({
      id: PKG_ID, client_user_id: USER_ID, total_sessions: 10, remaining_sessions: 8,
    })
  })

  it('redeem decrements and inserts redemption', async () => {
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 9, client_user_id: USER_ID })
    repo.insertRedemption.mockResolvedValue()
    await service.redeem(ctx, { packageId: PKG_ID, bookingId: BOOK_ID })
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, -1)
    expect(repo.insertRedemption).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ packageId: PKG_ID, bookingId: BOOK_ID, delta: -1, reason: 'redeem' }),
    )
  })

  it('redeem throws ConflictError when no sessions left', async () => {
    repo.decrementSessions.mockResolvedValue(null)
    await expect(service.redeem(ctx, { packageId: PKG_ID })).rejects.toThrow(ConflictError)
  })

  it('redeem publishes package.exhausted on last session', async () => {
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'exhausted', remaining_sessions: 0, client_user_id: USER_ID })
    repo.insertRedemption.mockResolvedValue()
    await service.redeem(ctx, { packageId: PKG_ID })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.exhausted' }))
  })

  it('refundSession rejects when nothing has been redeemed', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, total_sessions: 10, remaining_sessions: 10 })
    await expect(service.refundSession(ctx, { packageId: PKG_ID })).rejects.toThrow(ConflictError)
  })

  it('refundSession increments and re-activates exhausted package', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, total_sessions: 10, remaining_sessions: 0, status: 'exhausted' })
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, remaining_sessions: 1 })
    repo.insertRedemption.mockResolvedValue()
    repo.setStatus.mockResolvedValue({ id: PKG_ID, status: 'active' })
    await service.refundSession(ctx, { packageId: PKG_ID })
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, +1)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, 'active')
  })

  it('refundSession throws NotFoundError when missing', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.refundSession(ctx, { packageId: PKG_ID })).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking lifecycle', () => {
  it('booking.completed redeems the linked package', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: PKG_ID }] })
      return fn(c)
    })
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID })
    repo.insertRedemption.mockResolvedValue()
    await service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, -1)
  })

  it('booking.cancelled refunds the linked package', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: PKG_ID }] })
      return fn(c)
    })
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID })
    repo.insertRedemption.mockResolvedValue()
    await service.handleEvent({
      type: 'booking.cancelled',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, +1)
  })

  it('skips when booking is not linked to a package', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: null }] })
      return fn(c)
    })
    await service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })
    expect(repo.decrementSessions).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    withTenantTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(service.handleEvent({
      type: 'booking.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID },
    })).resolves.toBeUndefined()
  })
})
