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
}))
vi.mock('../repositories/disputes.repository.js')

import * as service from '../services/disputes.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/disputes.repository.js'
import { ConflictError, ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DIS_ID    = '11111111-1111-1111-1111-111111111111'
const ORDER_ID  = '22222222-2222-2222-2222-222222222222'
const BUYER     = '33333333-3333-3333-3333-333333333333'
const VENDOR    = '44444444-4444-4444-4444-444444444444'

const buyerCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: BUYER,  role: 'buyer' }
const vendorCtx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: VENDOR, role: 'vendor' }
const staffCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'staff1', role: 'staff' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── openDispute ────────────────────────────────────────────────────────
describe('openDispute', () => {
  it('persists, scopes, publishes dispute.opened', async () => {
    repo.findByOrderId.mockResolvedValue(null)
    repo.insert.mockResolvedValue({ id: DIS_ID })
    await service.openDispute(buyerCtx, { orderId: ORDER_ID, reason: 'not_received' })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ orderId: ORDER_ID, reason: 'not_received', buyerUserId: BUYER }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dispute.opened',
      payload: expect.objectContaining({ disputeId: DIS_ID, orderId: ORDER_ID, reason: 'not_received' }),
    }))
  })

  it('rejects when dispute already exists for order', async () => {
    repo.findByOrderId.mockResolvedValue({ id: DIS_ID })
    await expect(service.openDispute(buyerCtx, { orderId: ORDER_ID, reason: 'x' })).rejects.toThrow(ConflictError)
  })
})

// ── getDispute / listDisputes ──────────────────────────────────────────
describe('reads', () => {
  it('getDispute returns messages and evidence', async () => {
    repo.findById.mockResolvedValue({ id: DIS_ID, buyer_user_id: BUYER })
    repo.listMessages.mockResolvedValue([{ id: 'm1' }])
    repo.listEvidence.mockResolvedValue([{ id: 'e1' }])
    const r = await service.getDispute(buyerCtx, DIS_ID)
    expect(r.messages).toHaveLength(1)
    expect(r.evidence).toHaveLength(1)
  })

  it('getDispute throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getDispute(buyerCtx, DIS_ID)).rejects.toThrow(NotFoundError)
  })

  it('listDisputes passes filters', async () => {
    repo.listByTenant.mockResolvedValue([])
    await service.listDisputes(buyerCtx, { status: 'open' })
    expect(repo.listByTenant).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { status: 'open' })
  })
})

// ── postMessage — sender role inference ────────────────────────────────
describe('postMessage role inference', () => {
  it('staff sender → senderRole=staff', async () => {
    repo.findById.mockResolvedValue({ id: DIS_ID, buyer_user_id: BUYER })
    repo.insertMessage.mockResolvedValue({ id: 'm1' })
    await service.postMessage(staffCtx, DIS_ID, 'staff note', [])
    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, DIS_ID, 'staff1', 'staff', 'staff note', [],
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ senderRole: 'staff' }),
    }))
  })

  it('matching buyer → senderRole=buyer', async () => {
    repo.findById.mockResolvedValue({ id: DIS_ID, buyer_user_id: BUYER })
    repo.insertMessage.mockResolvedValue({ id: 'm2' })
    await service.postMessage(buyerCtx, DIS_ID, 'buyer says', [])
    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, DIS_ID, BUYER, 'buyer', 'buyer says', [],
    )
  })

  it('non-buyer non-staff → senderRole=vendor', async () => {
    repo.findById.mockResolvedValue({ id: DIS_ID, buyer_user_id: BUYER })
    repo.insertMessage.mockResolvedValue({ id: 'm3' })
    await service.postMessage(vendorCtx, DIS_ID, 'vendor reply', [])
    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, DIS_ID, VENDOR, 'vendor', 'vendor reply', [],
    )
  })

  it('throws NotFoundError when dispute missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.postMessage(buyerCtx, DIS_ID, 'x')).rejects.toThrow(NotFoundError)
  })
})

// ── uploadEvidence ─────────────────────────────────────────────────────
describe('uploadEvidence', () => {
  it('persists evidence', async () => {
    repo.findById.mockResolvedValue({ id: DIS_ID })
    repo.insertEvidence.mockResolvedValue({ id: 'e1' })
    await service.uploadEvidence(buyerCtx, DIS_ID, 'photo', { url: 'x' })
    expect(repo.insertEvidence).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, DIS_ID, 'photo', { url: 'x' }, BUYER,
    )
  })

  it('throws NotFoundError when dispute missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.uploadEvidence(buyerCtx, DIS_ID, 'photo', {})).rejects.toThrow(NotFoundError)
  })
})

// ── resolve ────────────────────────────────────────────────────────────
describe('resolve', () => {
  it('rejects when caller is not staff', async () => {
    await expect(service.resolve(buyerCtx, DIS_ID, { status: 'resolved_buyer' })).rejects.toThrow(ForbiddenError)
  })

  it('updates and publishes dispute.resolved', async () => {
    repo.updateStatus.mockResolvedValue({ id: DIS_ID, order_id: ORDER_ID, status: 'resolved_buyer', resolution_amount_cents: 500 })
    await service.resolve(staffCtx, DIS_ID, { status: 'resolved_buyer', resolutionAmountCents: 500 })
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, DIS_ID,
      expect.objectContaining({ status: 'resolved_buyer', resolutionAmountCents: 500, resolvedByUserId: 'staff1' }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dispute.resolved',
      payload: expect.objectContaining({ disputeId: DIS_ID, status: 'resolved_buyer', resolutionAmountCents: 500 }),
    }))
  })

  it('throws NotFoundError when dispute missing', async () => {
    repo.updateStatus.mockResolvedValue(null)
    await expect(service.resolve(staffCtx, DIS_ID, { status: 'resolved_buyer' })).rejects.toThrow(NotFoundError)
  })
})

// ── handleEvent — splitpay.chargeback escalates ────────────────────────
describe('handleEvent', () => {
  it('splitpay.chargeback.created → escalates matching dispute', async () => {
    repo.findByOrderId.mockResolvedValue({ id: DIS_ID })
    repo.updateStatus.mockResolvedValue({ id: DIS_ID, status: 'escalated_chargeback' })
    await service.handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, DIS_ID,
      expect.objectContaining({ status: 'escalated_chargeback' }),
    )
  })

  it('does nothing if no internal dispute matches the order', async () => {
    repo.findByOrderId.mockResolvedValue(null)
    await service.handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('ignores unrelated event types', async () => {
    await service.handleEvent({ type: 'order.created', payload: {} })
    expect(repo.findByOrderId).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    repo.findByOrderId.mockRejectedValue(new Error('boom'))
    await expect(service.handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })).resolves.toBeUndefined()
  })
})
