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
vi.mock('../repositories/messaging.repository.js')

import * as service from '../services/messaging.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/messaging.repository.js'
import { ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const THREAD_ID = '11111111-1111-1111-1111-111111111111'
const BUYER    = '22222222-2222-2222-2222-222222222222'
const VENDOR   = '33333333-3333-3333-3333-333333333333'
const STAFF    = '44444444-4444-4444-4444-444444444444'
const ORDER_ID = '55555555-5555-5555-5555-555555555555'

const buyerCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: BUYER,  role: 'buyer' }
const vendorCtx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: VENDOR, role: 'vendor' }
const staffCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: STAFF,  role: 'staff' }
const otherCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'other', role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

const thread = {
  id: THREAD_ID, buyer_user_id: BUYER, vendor_user_id: VENDOR, order_id: ORDER_ID, status: 'open',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── createThread / listThreads ───────────────────────────────────────
describe('createThread / listThreads', () => {
  it('createThread injects scope', async () => {
    repo.insertThread.mockResolvedValue(thread)
    await service.createThread(buyerCtx, { buyerUserId: BUYER, vendorUserId: VENDOR, orderId: ORDER_ID })
    expect(repo.insertThread).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ buyerUserId: BUYER, vendorUserId: VENDOR, orderId: ORDER_ID }),
    )
  })

  it('listThreads filters by user role', async () => {
    repo.listThreadsForUser.mockResolvedValue([thread])
    await service.listThreads(vendorCtx, 'vendor')
    expect(repo.listThreadsForUser).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, VENDOR, 'vendor')
  })
})

// ── access control ───────────────────────────────────────────────────
describe('access control', () => {
  it('getThread allows buyer', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    const r = await service.getThread(buyerCtx, THREAD_ID)
    expect(r).toEqual(thread)
  })

  it('getThread allows vendor', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    await service.getThread(vendorCtx, THREAD_ID)
  })

  it('getThread allows staff (third party)', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    await service.getThread(staffCtx, THREAD_ID)
  })

  it('getThread rejects non-participant non-staff', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    await expect(service.getThread(otherCtx, THREAD_ID)).rejects.toThrow(ForbiddenError)
  })

  it('getThread throws NotFoundError when thread missing', async () => {
    repo.findThreadById.mockResolvedValue(null)
    await expect(service.getThread(buyerCtx, THREAD_ID)).rejects.toThrow(NotFoundError)
  })
})

// ── postMessage ──────────────────────────────────────────────────────
describe('postMessage', () => {
  it('persists message and publishes message.created with correct recipient', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    repo.insertMessage.mockResolvedValue({ id: 'm1' })
    await service.postMessage(buyerCtx, THREAD_ID, 'hi', [])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message.created',
      payload: expect.objectContaining({
        messageId: 'm1', threadId: THREAD_ID, senderUserId: BUYER, recipientUserId: VENDOR,
        orderId: ORDER_ID,
      }),
    }))
  })

  it('vendor sender → buyer recipient', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    repo.insertMessage.mockResolvedValue({ id: 'm2' })
    await service.postMessage(vendorCtx, THREAD_ID, 'reply', [])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ senderUserId: VENDOR, recipientUserId: BUYER }),
    }))
  })

  it('rejects non-participant', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    await expect(service.postMessage(otherCtx, THREAD_ID, 'sneaky', [])).rejects.toThrow(ForbiddenError)
  })

  it('defaults attachments to []', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    repo.insertMessage.mockResolvedValue({ id: 'm3' })
    await service.postMessage(buyerCtx, THREAD_ID, 'hi')
    expect(repo.insertMessage).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, THREAD_ID, BUYER, 'hi', [],
    )
  })
})

// ── listMessages ─────────────────────────────────────────────────────
describe('listMessages', () => {
  it('lists when participant', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    repo.listMessages.mockResolvedValue([{ id: 'm1' }])
    const r = await service.listMessages(buyerCtx, THREAD_ID, { limit: 10 })
    expect(r).toHaveLength(1)
  })

  it('rejects non-participant', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    await expect(service.listMessages(otherCtx, THREAD_ID, {})).rejects.toThrow(ForbiddenError)
  })
})

// ── markRead ─────────────────────────────────────────────────────────
describe('markRead', () => {
  it('marks read for participant', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    repo.markRead.mockResolvedValue(true)
    await expect(service.markRead(buyerCtx, THREAD_ID, 'msg1')).resolves.toBeUndefined()
  })

  it('throws NotFoundError when message missing', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    repo.markRead.mockResolvedValue(false)
    await expect(service.markRead(buyerCtx, THREAD_ID, 'msg1')).rejects.toThrow(NotFoundError)
  })

  it('rejects non-participant', async () => {
    repo.findThreadById.mockResolvedValue(thread)
    await expect(service.markRead(otherCtx, THREAD_ID, 'msg1')).rejects.toThrow(ForbiddenError)
  })
})
