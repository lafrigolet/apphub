/**
 * Integration tests for platform/reviews — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-reviews test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createReview, getReview, listByTarget, aggregateForTarget, reply, setStatus, remove,
} from '../../services/reviews.service.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'

const APP_ID    = 'int-test-rev'
const TENANT_ID = '00000000-0000-0000-0000-0000000001c1'

let adminPool, redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_reviews.review_replies WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_reviews.reviews        WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'buyer', ...overrides,
})

describe('createReview', () => {
  it('persists with status=published by default', async () => {
    const r = await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5, title: 'great', body: 'love it' })
    expect(r.status).toBe('published')
    expect(r.app_id).toBe(APP_ID)
  })

  it('throws ConflictError on duplicate (buyer, target, order)', async () => {
    await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5 })
    await expect(createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 4 }))
      .rejects.toThrow(ConflictError)
  })

  it('different orders allow multiple reviews of same target by same buyer', async () => {
    await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5, orderId: uuidv4() })
    await expect(createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 4, orderId: uuidv4() }))
      .resolves.toBeTruthy()
  })
})

describe('getReview / listByTarget / aggregateForTarget', () => {
  it('getReview includes replies', async () => {
    const r = await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5 })
    await reply({ ...ctx(), userId: '99999999-9999-9999-9999-999999999999' }, r.id, 'thanks')
    const full = await getReview(ctx(), r.id)
    expect(full.replies).toHaveLength(1)
  })

  it('getReview throws NotFoundError on unknown id', async () => {
    await expect(getReview(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('listByTarget returns published reviews for target', async () => {
    await createReview(ctx({ userId: uuidv4() }), { targetType: 'product', targetId: 'p1', rating: 5 })
    await createReview(ctx({ userId: uuidv4() }), { targetType: 'product', targetId: 'p1', rating: 4 })
    const list = await listByTarget(ctx(), { targetType: 'product', targetId: 'p1' })
    expect(list).toHaveLength(2)
  })

  it('listByTarget validates required params', async () => {
    await expect(listByTarget(ctx(), { targetType: 'product' })).rejects.toThrow(ValidationError)
  })

  it('aggregateForTarget computes total + average + histogram', async () => {
    for (const r of [5, 5, 4, 3, 1]) {
      await createReview(ctx({ userId: uuidv4() }), { targetType: 'product', targetId: 'p1', rating: r })
    }
    const a = await aggregateForTarget(ctx(), { targetType: 'product', targetId: 'p1' })
    expect(a.total).toBe(5)
    expect(a.average).toBeCloseTo(3.6, 1)
    expect(a.r5).toBe(2)
    expect(a.r1).toBe(1)
  })
})

describe('reply', () => {
  it('persists reply and emits review.replied', async () => {
    const r = await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((rs) => setTimeout(rs, 50))

    try {
      await reply({ ...ctx(), userId: uuidv4() }, r.id, 'thank you!')
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'review.replied')) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      expect(events.find((e) => e.type === 'review.replied' && e.payload.reviewId === r.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('throws NotFoundError on unknown review id', async () => {
    await expect(reply(ctx(), uuidv4(), 'x')).rejects.toThrow(NotFoundError)
  })
})

describe('setStatus / remove', () => {
  it('hide makes review invisible to listByTarget(default published filter)', async () => {
    const r = await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5 })
    await setStatus(ctx(), r.id, 'hidden')
    const list = await listByTarget(ctx(), { targetType: 'product', targetId: 'p1' })
    expect(list.find((x) => x.id === r.id)).toBeFalsy()
  })

  it('publishes review.hidden when hiding', async () => {
    const r = await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((rs) => setTimeout(rs, 50))

    try {
      await setStatus(ctx(), r.id, 'hidden')
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'review.hidden')) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      expect(events.find((e) => e.type === 'review.hidden' && e.payload.reviewId === r.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('remove deletes; subsequent get throws NotFoundError', async () => {
    const r = await createReview(ctx(), { targetType: 'product', targetId: 'p1', rating: 5 })
    await remove(ctx(), r.id)
    await expect(getReview(ctx(), r.id)).rejects.toThrow(NotFoundError)
  })

  it('remove on unknown id throws NotFoundError', async () => {
    await expect(remove(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('tenant isolation', () => {
  it('reviews from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000001c2'
    await createReview(ctx(),                      { targetType: 'product', targetId: 'p1', rating: 5 })
    await createReview(ctx({ tenantId: T2, userId: uuidv4() }), { targetType: 'product', targetId: 'p1', rating: 5 })
    const list = await listByTarget(ctx(), { targetType: 'product', targetId: 'p1' })
    expect(list.every((r) => r.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_reviews.reviews WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})

// ── verified-purchase ─────────────────────────────────────────────────
// Stub fetch globally so isVerifiedPurchase doesn't hit a real HTTP server.
// The integration test verifies that the boolean flows through schema + repo
// + event + the listByTarget verifiedOnly filter + the aggregate count.
describe('verified_purchase', () => {
  let originalFetch
  beforeAll(() => { originalFetch = global.fetch })
  afterAll(()  => { global.fetch  = originalFetch })

  function stubFetchOrder({ buyerUserId, status }) {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200, ok: true,
      json: async () => ({ buyer_user_id: buyerUserId, status }),
    })
  }

  it('marks verified=true for orderId + buyer match + paid status', async () => {
    const userId = '11111111-1111-1111-1111-111111111111'
    stubFetchOrder({ buyerUserId: userId, status: 'paid' })
    const r = await createReview(
      { ...ctx(), userId, jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pVerified', rating: 5, orderId: uuidv4() },
    )
    expect(r.verified_purchase).toBe(true)
  })

  it('marks verified=false when buyer mismatches', async () => {
    stubFetchOrder({ buyerUserId: 'someone-else', status: 'paid' })
    const r = await createReview(
      { ...ctx(), jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pVerified-2', rating: 5, orderId: uuidv4() },
    )
    expect(r.verified_purchase).toBe(false)
  })

  it('marks verified=false when status is cancelled', async () => {
    const userId = '11111111-1111-1111-1111-111111111111'
    stubFetchOrder({ buyerUserId: userId, status: 'cancelled' })
    const r = await createReview(
      { ...ctx(), userId, jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pVerified-3', rating: 5, orderId: uuidv4() },
    )
    expect(r.verified_purchase).toBe(false)
  })

  it('marks verified=false on HTTP timeout (soft-fail)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const r = await createReview(
      { ...ctx(), jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pVerified-4', rating: 5, orderId: uuidv4() },
    )
    expect(r.verified_purchase).toBe(false)
  })

  it('listByTarget verifiedOnly filters out unverified', async () => {
    const userId = '11111111-1111-1111-1111-111111111111'
    // 1st review: verified
    stubFetchOrder({ buyerUserId: userId, status: 'paid' })
    await createReview(
      { ...ctx(), userId, jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pFilter', rating: 5, orderId: uuidv4() },
    )
    // 2nd review: unverified (different buyer in mock)
    stubFetchOrder({ buyerUserId: 'someone-else', status: 'paid' })
    await createReview(
      { ...ctx(), userId: uuidv4(), jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pFilter', rating: 4, orderId: uuidv4() },
    )

    const all = await listByTarget(ctx(), { targetType: 'product', targetId: 'pFilter' })
    expect(all).toHaveLength(2)
    const onlyVerified = await listByTarget(ctx(), { targetType: 'product', targetId: 'pFilter', verifiedOnly: true })
    expect(onlyVerified).toHaveLength(1)
    expect(onlyVerified[0].verified_purchase).toBe(true)
  })

  it('aggregate returns verified_count', async () => {
    const userId = '11111111-1111-1111-1111-111111111111'
    stubFetchOrder({ buyerUserId: userId, status: 'paid' })
    await createReview(
      { ...ctx(), userId, jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pAgg', rating: 5, orderId: uuidv4() },
    )
    stubFetchOrder({ buyerUserId: 'someone-else', status: 'paid' })
    await createReview(
      { ...ctx(), userId: uuidv4(), jwt: 'fake.jwt' },
      { targetType: 'product', targetId: 'pAgg', rating: 4, orderId: uuidv4() },
    )
    const agg = await aggregateForTarget(ctx(), { targetType: 'product', targetId: 'pAgg' })
    expect(agg.total).toBe(2)
    expect(agg.verified_count).toBe(1)
  })
})
