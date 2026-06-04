// Tests for the priority features added per docs/use-cases/disputes.md:
//   #1 controlled reason_code vocabulary (propagated to event + repo)
//   #3 status-history trail + staff-only internal notes + FSM terminal guards
//   #3 withdrawn status (buyer self-service retraction)
//   #4 visibility scoping (buyer lists/reads only own disputes; internal notes
//      hidden from non-staff)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/disputes.repository.js')

import * as service from '../services/disputes.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/disputes.repository.js'
import { ConflictError, ForbiddenError } from '@apphub/platform-sdk/errors'

const APP   = 'shop'
const TEN   = 't1'
const ID    = 'd1'
const ORD   = 'o1'
const BUYER = 'buyer-1'

const buyerCtx  = { appId: APP, tenantId: TEN, subTenantId: null, userId: BUYER, role: 'buyer' }
const vendorCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'v1', role: 'vendor' }
const staffCtx  = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'staff1', role: 'staff' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── #1 reason_code vocabulary ───────────────────────────────────────────
describe('openDispute — reason_code', () => {
  it('persists reasonCode and includes it in dispute.opened', async () => {
    repo.findByOrderId.mockResolvedValue(null)
    repo.insert.mockResolvedValue({ id: ID })
    repo.insertStatusHistory.mockResolvedValue({})
    await service.openDispute(buyerCtx, { orderId: ORD, reason: 'free text', reasonCode: 'item_damaged' })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP, TEN,
      expect.objectContaining({ reasonCode: 'item_damaged', buyerUserId: BUYER }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dispute.opened',
      payload: expect.objectContaining({ reasonCode: 'item_damaged' }),
    }))
  })

  it('records an initial open status-history row', async () => {
    repo.findByOrderId.mockResolvedValue(null)
    repo.insert.mockResolvedValue({ id: ID })
    repo.insertStatusHistory.mockResolvedValue({})
    await service.openDispute(buyerCtx, { orderId: ORD, reason: 'x' })
    expect(repo.insertStatusHistory).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, ID,
      expect.objectContaining({ fromStatus: null, toStatus: 'open', actorRole: 'buyer' }),
    )
  })
})

// ── #4 list scoping ─────────────────────────────────────────────────────
describe('listDisputes — visibility scoping', () => {
  it('buyer is forced to their own buyerUserId', async () => {
    repo.listByTenant.mockResolvedValue([])
    await service.listDisputes(buyerCtx, { status: 'open' })
    expect(repo.listByTenant).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, expect.objectContaining({ buyerUserId: BUYER }),
    )
  })

  it('staff list is not scoped to a buyer', async () => {
    repo.listByTenant.mockResolvedValue([])
    await service.listDisputes(staffCtx, { status: 'open' })
    expect(repo.listByTenant).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, { status: 'open' },
    )
  })
})

// ── #4 getDispute internal-note visibility ──────────────────────────────
describe('getDispute — internal notes + history', () => {
  it('non-staff caller does NOT receive internal messages', async () => {
    repo.findById.mockResolvedValue({ id: ID, buyer_user_id: BUYER })
    repo.listMessages.mockResolvedValue([])
    repo.listEvidence.mockResolvedValue([])
    repo.listStatusHistory.mockResolvedValue([])
    await service.getDispute(buyerCtx, ID)
    expect(repo.listMessages).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID, { includeInternal: false })
  })

  it('staff caller receives internal messages', async () => {
    repo.findById.mockResolvedValue({ id: ID, buyer_user_id: BUYER })
    repo.listMessages.mockResolvedValue([])
    repo.listEvidence.mockResolvedValue([])
    repo.listStatusHistory.mockResolvedValue([])
    const r = await service.getDispute(staffCtx, ID)
    expect(repo.listMessages).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID, { includeInternal: true })
    expect(r.statusHistory).toEqual([])
  })
})

// ── #3 internal notes posting ───────────────────────────────────────────
describe('postMessage — internal notes', () => {
  it('non-staff cannot post an internal note', async () => {
    await expect(service.postMessage(buyerCtx, ID, 'secret', [], true)).rejects.toThrow(ForbiddenError)
  })

  it('staff internal note is persisted but NOT published to the bus', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'investigating', buyer_user_id: BUYER })
    repo.insertMessage.mockResolvedValue({ id: 'm1' })
    await service.postMessage(staffCtx, ID, 'staff only', [], true)
    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, ID, 'staff1', 'staff', 'staff only', [], true,
    )
    expect(publish).not.toHaveBeenCalled()
  })

  it('non-staff cannot post on a terminal dispute', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'resolved_buyer', buyer_user_id: BUYER })
    await expect(service.postMessage(buyerCtx, ID, 'hi')).rejects.toThrow(ForbiddenError)
  })

  it('staff can still post on a terminal dispute', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'resolved_buyer', buyer_user_id: BUYER })
    repo.insertMessage.mockResolvedValue({ id: 'm1' })
    await service.postMessage(staffCtx, ID, 'follow-up')
    expect(repo.insertMessage).toHaveBeenCalled()
  })
})

// ── #3 resolve FSM guard + history ──────────────────────────────────────
describe('resolve — FSM guard + history trail', () => {
  it('refuses to resolve a terminal dispute', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'withdrawn' })
    await expect(service.resolve(staffCtx, ID, { status: 'resolved_buyer' })).rejects.toThrow(ConflictError)
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('records a status-history row on resolution', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'investigating' })
    repo.updateStatus.mockResolvedValue({ id: ID, order_id: ORD, status: 'resolved_vendor', resolution_amount_cents: 0 })
    await service.resolve(staffCtx, ID, { status: 'resolved_vendor', resolutionNotes: 'vendor wins' })
    expect(repo.insertStatusHistory).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, ID,
      expect.objectContaining({ fromStatus: 'investigating', toStatus: 'resolved_vendor', note: 'vendor wins', actorRole: 'staff' }),
    )
  })
})

// ── #3 withdraw ─────────────────────────────────────────────────────────
describe('withdraw', () => {
  it('buyer withdraws an open dispute → status withdrawn + event', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'open', buyer_user_id: BUYER })
    repo.updateStatus.mockResolvedValue({ id: ID, order_id: ORD, status: 'withdrawn' })
    await service.withdraw(buyerCtx, ID, 'changed my mind')
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, ID, expect.objectContaining({ status: 'withdrawn' }),
    )
    expect(repo.insertStatusHistory).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, ID,
      expect.objectContaining({ toStatus: 'withdrawn', actorRole: 'buyer', note: 'changed my mind' }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'dispute.withdrawn' }))
  })

  it('a non-owner buyer/vendor cannot withdraw', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'open', buyer_user_id: BUYER })
    await expect(service.withdraw(vendorCtx, ID)).rejects.toThrow(ForbiddenError)
  })

  it('cannot withdraw a resolved dispute', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'resolved_buyer', buyer_user_id: BUYER })
    await expect(service.withdraw(buyerCtx, ID)).rejects.toThrow(ConflictError)
  })

  it('staff may also withdraw on the buyer\'s behalf', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'investigating', buyer_user_id: BUYER })
    repo.updateStatus.mockResolvedValue({ id: ID, order_id: ORD, status: 'withdrawn' })
    await service.withdraw(staffCtx, ID)
    expect(repo.insertStatusHistory).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, ID, expect.objectContaining({ actorRole: 'staff' }),
    )
  })
})
