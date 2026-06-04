// Casos de uso prioritarios (backend-only) del módulo packages:
//   #1 FIFO fallback en handleEvent
//   #4 cancelación con reembolso proporcional (package.refunded)
//   #5 idempotencia de redención (redeem / handleEvent)
//   #6 redeemer_user_id en redemptions
//   #8 ajuste manual de saldo (reason='adjust', staff only)
//   #9 freeze / unfreeze / extend de la validez (staff only)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/packages.repository.js')

import * as service from '../services/packages.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/packages.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PKG_ID    = '22222222-2222-2222-2222-222222222222'
const SVC_ID    = '33333333-3333-3333-3333-333333333333'
const USER_ID   = '44444444-4444-4444-4444-444444444444'
const BOOK_ID   = '55555555-5555-5555-5555-555555555555'

const owner = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'buyer' }
const staff = { ...owner, userId: 'staff-1', role: 'staff' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── #5 + #6 redeem ──────────────────────────────────────────────────────
describe('#5/#6 redeem idempotency + redeemer', () => {
  beforeEach(() => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, client_user_id: USER_ID, remaining_sessions: 5, total_sessions: 10 })
  })

  it('skips decrement when bookingId already redeemed (idempotent)', async () => {
    repo.redeemExistsForBooking.mockResolvedValue(true)
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, client_user_id: USER_ID, remaining_sessions: 5 })
    const r = await service.redeem(owner, { packageId: PKG_ID, bookingId: BOOK_ID })
    expect(repo.decrementSessions).not.toHaveBeenCalled()
    expect(repo.insertRedemption).not.toHaveBeenCalled()
    expect(r).toMatchObject({ id: PKG_ID })
  })

  it('records redeemer_user_id for a normal user redemption', async () => {
    repo.redeemExistsForBooking.mockResolvedValue(false)
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 4 })
    await service.redeem(owner, { packageId: PKG_ID, bookingId: BOOK_ID })
    expect(repo.insertRedemption).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ redeemerUserId: USER_ID, reason: 'redeem' }),
    )
  })

  it('system ctx records null redeemer', async () => {
    const sys = { ...owner, role: 'system', userId: null }
    repo.redeemExistsForBooking.mockResolvedValue(false)
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 4 })
    await service.redeem(sys, { packageId: PKG_ID })
    expect(repo.insertRedemption).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ redeemerUserId: null }),
    )
  })
})

// ── #1 FIFO fallback + #5 idempotency in handleEvent ───────────────────
describe('#1 handleEvent FIFO fallback', () => {
  it('auto-selects the soonest-expiring package when booking has no package_id', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: null, client_user_id: USER_ID, service_id: SVC_ID }] })
      return fn(c)
    })
    repo.findActivePackageFor.mockResolvedValue({ id: PKG_ID })
    repo.redeemExistsForBooking.mockResolvedValue(false)
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active' })
    await service.handleEvent({ type: 'booking.completed', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.findActivePackageFor).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, USER_ID, SVC_ID)
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, -1)
  })

  it('does NOT redeem twice when booking.completed arrives duplicated', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: PKG_ID, client_user_id: USER_ID, service_id: SVC_ID }] })
      return fn(c)
    })
    repo.redeemExistsForBooking.mockResolvedValue(true)
    await service.handleEvent({ type: 'booking.completed', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(repo.decrementSessions).not.toHaveBeenCalled()
  })

  it('publishes package.exhausted from handleEvent on last session', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: PKG_ID, client_user_id: USER_ID, service_id: SVC_ID }] })
      return fn(c)
    })
    repo.redeemExistsForBooking.mockResolvedValue(false)
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'exhausted', client_user_id: USER_ID })
    await service.handleEvent({ type: 'booking.completed', payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.exhausted' }))
  })
})

// ── #8 manual adjust ────────────────────────────────────────────────────
describe('#8 adjustBalance', () => {
  it('rejects non-staff', async () => {
    await expect(service.adjustBalance(owner, PKG_ID, { delta: 1 })).rejects.toThrow(ConflictError)
  })
  it('rejects zero delta', async () => {
    await expect(service.adjustBalance(staff, PKG_ID, { delta: 0 })).rejects.toThrow(ConflictError)
  })
  it('applies positive delta, re-activates exhausted, logs reason=adjust', async () => {
    repo.findPurchaseById
      .mockResolvedValueOnce({ id: PKG_ID, status: 'exhausted', remaining_sessions: 0, total_sessions: 10 })
      .mockResolvedValueOnce({ id: PKG_ID, status: 'active', remaining_sessions: 2 })
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, remaining_sessions: 2 })
    await service.adjustBalance(staff, PKG_ID, { delta: 2, note: 'goodwill' })
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, 2)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, 'active')
    expect(repo.insertRedemption).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ delta: 2, reason: 'adjust', redeemerUserId: 'staff-1' }),
    )
  })
  it('throws when decrement clamps (out of range)', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 0, total_sessions: 10 })
    repo.decrementSessions.mockResolvedValue(null)
    await expect(service.adjustBalance(staff, PKG_ID, { delta: -1 })).rejects.toThrow(ConflictError)
  })
})

// ── #9 freeze / unfreeze / extend ───────────────────────────────────────
describe('#9 freeze / unfreeze / extend', () => {
  it('freeze rejects non-staff', async () => {
    await expect(service.freezePackage(owner, PKG_ID)).rejects.toThrow(ConflictError)
  })
  it('freeze flips status and publishes package.frozen', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'active' })
    repo.freezePackage.mockResolvedValue({ id: PKG_ID, status: 'frozen', client_user_id: USER_ID })
    repo.insertFreeze.mockResolvedValue({})
    await service.freezePackage(staff, PKG_ID, { reason: 'vacaciones' })
    expect(repo.insertFreeze).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.frozen' }))
  })
  it('freeze of non-active throws', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'expired' })
    repo.freezePackage.mockResolvedValue(null)
    await expect(service.freezePackage(staff, PKG_ID)).rejects.toThrow(ConflictError)
  })
  it('unfreeze extends expiry, closes freeze, publishes package.unfrozen', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'frozen', frozen_days_total: 0 })
    repo.unfreezePackage.mockResolvedValue({ id: PKG_ID, status: 'active', frozen_days_total: 5, client_user_id: USER_ID })
    repo.closeFreeze.mockResolvedValue({})
    await service.unfreezePackage(staff, PKG_ID)
    expect(repo.closeFreeze).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, 5)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.unfrozen' }))
  })
  it('unfreeze of non-frozen throws', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'active' })
    repo.unfreezePackage.mockResolvedValue(null)
    await expect(service.unfreezePackage(staff, PKG_ID)).rejects.toThrow(ConflictError)
  })
  it('extend rejects non-positive days', async () => {
    await expect(service.extendExpiry(staff, PKG_ID, { days: 0 })).rejects.toThrow(ConflictError)
  })
  it('extend applies days', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'active' })
    repo.extendExpiry.mockResolvedValue({ id: PKG_ID })
    await service.extendExpiry(staff, PKG_ID, { days: 14 })
    expect(repo.extendExpiry).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, 14)
  })
})

// ── #4 cancellation with proportional refund ────────────────────────────
describe('#4 cancelPackage', () => {
  it('rejects non-staff', async () => {
    await expect(service.cancelPackage(owner, PKG_ID)).rejects.toThrow(ConflictError)
  })
  it('rejects already-refunded', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, status: 'refunded' })
    await expect(service.cancelPackage(staff, PKG_ID)).rejects.toThrow(ConflictError)
  })
  it('computes proportional refund and publishes package.refunded', async () => {
    repo.findPurchaseById.mockResolvedValue({
      id: PKG_ID, status: 'active', remaining_sessions: 4, total_sessions: 10,
      price_paid_cents: 40000, currency: 'EUR', client_user_id: USER_ID,
    })
    repo.setStatus.mockResolvedValue({ id: PKG_ID, status: 'refunded' })
    const r = await service.cancelPackage(staff, PKG_ID, {})
    // 4/10 * 40000 = 16000
    expect(r.refundCents).toBe(16000)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, PKG_ID, 'refunded')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'package.refunded',
      payload: expect.objectContaining({ refundCents: 16000, unusedSessions: 4 }),
    }))
  })
  it('applies penalty percentage', async () => {
    repo.findPurchaseById.mockResolvedValue({
      id: PKG_ID, status: 'active', remaining_sessions: 4, total_sessions: 10,
      price_paid_cents: 40000, currency: 'EUR', client_user_id: USER_ID,
    })
    repo.setStatus.mockResolvedValue({ id: PKG_ID, status: 'refunded' })
    const r = await service.cancelPackage(staff, PKG_ID, { penaltyPct: 25 })
    // 16000 * 0.75 = 12000
    expect(r.refundCents).toBe(12000)
  })
  it('throws NotFound when package missing', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.cancelPackage(staff, PKG_ID)).rejects.toThrow(NotFoundError)
  })
})
