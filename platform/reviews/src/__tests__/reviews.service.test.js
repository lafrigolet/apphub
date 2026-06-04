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
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}))
vi.mock('../repositories/reviews.repository.js')
vi.mock('../lib/orders-client.js', () => ({
  isVerifiedPurchase: vi.fn().mockResolvedValue(false),
}))

import * as service from '../services/reviews.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish, redis } from '../lib/redis.js'
import * as repo from '../repositories/reviews.repository.js'
import { isVerifiedPurchase } from '../lib/orders-client.js'
import { ConflictError, NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const REVIEW_ID = '11111111-1111-1111-1111-111111111111'
const TARGET_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID   = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── createReview ───────────────────────────────────────────────────────
describe('createReview', () => {
  it('persists, scopes, publishes review.created', async () => {
    repo.insert.mockResolvedValue({
      id: REVIEW_ID, target_type: 'product', target_id: TARGET_ID,
      rating: 5, buyer_user_id: USER_ID,
    })
    await service.createReview(ctx, { targetType: 'product', targetId: TARGET_ID, rating: 5 })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ targetType: 'product', targetId: TARGET_ID, rating: 5, buyerUserId: USER_ID }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'review.created',
      payload: expect.objectContaining({ reviewId: REVIEW_ID, targetType: 'product', rating: 5 }),
    }))
  })

  it('translates 23505 unique-violation into ConflictError', async () => {
    const dup = Object.assign(new Error('dup'), { code: '23505' })
    repo.insert.mockRejectedValue(dup)
    await expect(service.createReview(ctx, { targetType: 'product', targetId: TARGET_ID, rating: 5 }))
      .rejects.toThrow(ConflictError)
  })

  it('rethrows non-conflict errors', async () => {
    repo.insert.mockRejectedValue(new Error('boom'))
    await expect(service.createReview(ctx, { targetType: 'product', targetId: TARGET_ID, rating: 5 }))
      .rejects.toThrow('boom')
  })

  it('forwards verified=true to repo and event when orders-client says verified', async () => {
    isVerifiedPurchase.mockResolvedValueOnce(true)
    repo.insert.mockResolvedValue({
      id: REVIEW_ID, target_type: 'product', target_id: TARGET_ID,
      rating: 5, buyer_user_id: USER_ID, verified_purchase: true,
    })
    const ctxWithJwt = { ...ctx, jwt: 'fake.jwt' }
    await service.createReview(ctxWithJwt, {
      targetType: 'product', targetId: TARGET_ID, rating: 5, orderId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
    expect(isVerifiedPurchase).toHaveBeenCalledWith('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', USER_ID, 'fake.jwt')
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ verifiedPurchase: true }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ verifiedPurchase: true }),
    }))
  })

  it('forwards verified=false when orderId missing', async () => {
    isVerifiedPurchase.mockResolvedValueOnce(false)
    repo.insert.mockResolvedValue({
      id: REVIEW_ID, target_type: 'product', target_id: TARGET_ID,
      rating: 5, buyer_user_id: USER_ID, verified_purchase: false,
    })
    await service.createReview(ctx, { targetType: 'product', targetId: TARGET_ID, rating: 5 })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ verifiedPurchase: false }),
    )
  })
})

// ── getReview / listByTarget / aggregateForTarget ─────────────────────
describe('reads', () => {
  it('getReview attaches replies', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW_ID })
    repo.listReplies.mockResolvedValue([{ id: 'r1' }])
    const r = await service.getReview(ctx, REVIEW_ID)
    expect(r.replies).toHaveLength(1)
  })

  it('getReview throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getReview(ctx, REVIEW_ID)).rejects.toThrow(NotFoundError)
  })

  it('listByTarget validates required query params', async () => {
    await expect(service.listByTarget(ctx, { targetType: 'product' })).rejects.toThrow(ValidationError)
    await expect(service.listByTarget(ctx, { targetId: TARGET_ID })).rejects.toThrow(ValidationError)
  })

  it('listByTarget delegates with full args', async () => {
    repo.listByTarget.mockResolvedValue([])
    await service.listByTarget(ctx, { targetType: 'product', targetId: TARGET_ID, limit: 5 })
    expect(repo.listByTarget).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID,
      { targetType: 'product', targetId: TARGET_ID, limit: 5 })
  })

  it('aggregateForTarget validates required params', async () => {
    await expect(service.aggregateForTarget(ctx, {})).rejects.toThrow(ValidationError)
  })

  it('aggregateForTarget delegates', async () => {
    repo.aggregate.mockResolvedValue({ total: 3, average: 4.5 })
    const r = await service.aggregateForTarget(ctx, { targetType: 'product', targetId: TARGET_ID })
    expect(r.total).toBe(3)
  })
})

// ── reply ──────────────────────────────────────────────────────────────
describe('reply', () => {
  it('persists reply and publishes review.replied', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW_ID, buyer_user_id: USER_ID })
    repo.insertReply.mockResolvedValue({ id: 'rp1' })
    await service.reply(ctx, REVIEW_ID, 'thanks!')
    expect(repo.insertReply).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, REVIEW_ID, USER_ID, 'thanks!')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.replied' }))
  })

  it('throws NotFoundError when review missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.reply(ctx, REVIEW_ID, 'x')).rejects.toThrow(NotFoundError)
  })
})

// ── setStatus ──────────────────────────────────────────────────────────
describe('setStatus', () => {
  it('hides review and publishes review.hidden', async () => {
    repo.setStatus.mockResolvedValue({ id: REVIEW_ID, status: 'hidden' })
    await service.setStatus(ctx, REVIEW_ID, 'hidden')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.hidden' }))
  })

  it('does not publish when transitioning back to published', async () => {
    repo.setStatus.mockResolvedValue({ id: REVIEW_ID, status: 'published' })
    await service.setStatus(ctx, REVIEW_ID, 'published')
    expect(publish).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when review missing', async () => {
    repo.setStatus.mockResolvedValue(null)
    await expect(service.setStatus(ctx, REVIEW_ID, 'hidden')).rejects.toThrow(NotFoundError)
  })
})

// ── remove ─────────────────────────────────────────────────────────────
describe('remove', () => {
  it('removes review when present', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW_ID, target_type: 'product', target_id: TARGET_ID })
    repo.deleteById.mockResolvedValue(true)
    await expect(service.remove(ctx, REVIEW_ID)).resolves.toBeUndefined()
    expect(redis.del).toHaveBeenCalled()
  })

  it('throws NotFoundError when review missing', async () => {
    repo.findById.mockResolvedValue(null)
    repo.deleteById.mockResolvedValue(false)
    await expect(service.remove(ctx, REVIEW_ID)).rejects.toThrow(NotFoundError)
  })
})

// ── aggregate cache (recommendation #5) ──────────────────────────────────
describe('aggregateForTarget caching', () => {
  const q = { targetType: 'product', targetId: TARGET_ID }

  it('returns cached value without hitting the DB', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ total: 7, average: 4.2 }))
    const out = await service.aggregateForTarget(ctx, q)
    expect(out).toEqual({ total: 7, average: 4.2 })
    expect(repo.aggregate).not.toHaveBeenCalled()
  })

  it('computes + caches on miss', async () => {
    redis.get.mockResolvedValue(null)
    repo.aggregate.mockResolvedValue({ total: 2, average: 5 })
    const out = await service.aggregateForTarget(ctx, q)
    expect(out).toEqual({ total: 2, average: 5 })
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('reviews:agg:'), JSON.stringify({ total: 2, average: 5 }), 'EX', expect.any(Number),
    )
  })

  it('falls back to DB when Redis read fails', async () => {
    redis.get.mockRejectedValue(new Error('redis down'))
    repo.aggregate.mockResolvedValue({ total: 1, average: 3 })
    const out = await service.aggregateForTarget(ctx, q)
    expect(out).toEqual({ total: 1, average: 3 })
  })

  it('invalidates cache on createReview', async () => {
    isVerifiedPurchase.mockResolvedValueOnce(false)
    repo.insert.mockResolvedValue({
      id: REVIEW_ID, target_type: 'product', target_id: TARGET_ID, rating: 5, buyer_user_id: USER_ID,
    })
    await service.createReview(ctx, { targetType: 'product', targetId: TARGET_ID, rating: 5 })
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('reviews:agg:'))
  })
})

// ── setStatus reason + cache (recommendation #7) ─────────────────────────
describe('setStatus with reason', () => {
  it('passes moderationReason to repo and invalidates cache', async () => {
    repo.setStatus.mockResolvedValue({ id: REVIEW_ID, status: 'hidden', target_type: 'product', target_id: TARGET_ID })
    await service.setStatus(ctx, REVIEW_ID, 'hidden', 'spam')
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, REVIEW_ID, 'hidden', 'spam')
    expect(redis.del).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'review.hidden',
      payload: expect.objectContaining({ moderationReason: 'spam' }),
    }))
  })
})

describe('listForModeration', () => {
  it('delegates to repo', async () => {
    repo.listForModeration.mockResolvedValue([{ id: REVIEW_ID }])
    const out = await service.listForModeration(ctx, { status: 'pending' })
    expect(out).toHaveLength(1)
    expect(repo.listForModeration).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { status: 'pending' })
  })
})

// ── reports (recommendation #9) ──────────────────────────────────────────
describe('report', () => {
  it('persists report + publishes review.reported below threshold', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW_ID, status: 'published', buyer_user_id: USER_ID, target_type: 'product', target_id: TARGET_ID })
    repo.upsertReport.mockResolvedValue({ id: 'rep1' })
    repo.countOpenReports.mockResolvedValue(1)
    const out = await service.report(ctx, REVIEW_ID, 'spam', 'bot net')
    expect(out).toEqual(expect.objectContaining({ id: 'rep1', openCount: 1, autoHidden: false }))
    expect(repo.setStatus).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.reported' }))
  })

  it('auto-hides once open reports reach the threshold', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW_ID, status: 'published', buyer_user_id: USER_ID, target_type: 'product', target_id: TARGET_ID })
    repo.upsertReport.mockResolvedValue({ id: 'rep1' })
    repo.countOpenReports.mockResolvedValue(3)
    const out = await service.report(ctx, REVIEW_ID, 'spam')
    expect(out.autoHidden).toBe(true)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, REVIEW_ID, 'hidden', expect.any(String))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.hidden' }))
  })

  it('does not auto-hide an already-hidden review even past threshold', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW_ID, status: 'hidden', buyer_user_id: USER_ID, target_type: 'product', target_id: TARGET_ID })
    repo.upsertReport.mockResolvedValue({ id: 'rep1' })
    repo.countOpenReports.mockResolvedValue(5)
    const out = await service.report(ctx, REVIEW_ID, 'spam')
    expect(out.autoHidden).toBe(false)
    expect(repo.setStatus).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when review missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.report(ctx, REVIEW_ID, 'spam')).rejects.toThrow(NotFoundError)
  })
})

describe('report triage', () => {
  it('listReports delegates', async () => {
    repo.listReports.mockResolvedValue([{ id: 'rep1' }])
    const out = await service.listReports(ctx, { status: 'open' })
    expect(out).toHaveLength(1)
  })

  it('setReportStatus throws NotFoundError when missing', async () => {
    repo.setReportStatus.mockResolvedValue(null)
    await expect(service.setReportStatus(ctx, 'rep1', 'dismissed')).rejects.toThrow(NotFoundError)
  })

  it('setReportStatus returns updated report', async () => {
    repo.setReportStatus.mockResolvedValue({ id: 'rep1', status: 'dismissed' })
    const out = await service.setReportStatus(ctx, 'rep1', 'dismissed')
    expect(out.status).toBe('dismissed')
  })
})
