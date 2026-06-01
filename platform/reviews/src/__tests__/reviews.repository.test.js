// reviews.repository — SQL shape for platform_reviews.* tables.
// Validates column projection, parametrized params, COALESCE defaults,
// optional filters, pagination, vote upsert / recompute and tenant scoping.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/reviews.repository.js'

function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

const APP = 'shop'
const TEN = 't1'
const RID = 'rev1'
const UID = 'u1'

describe('insert', () => {
  it('INSERT with COALESCE status/verified defaults; full param order', async () => {
    const c = mockClient([{ id: RID }])
    const out = await repo.insert(c, APP, TEN, {
      targetType: 'product', targetId: 'sku', orderId: 'o1', buyerUserId: UID,
      rating: 5, title: 'T', body: 'B', status: 'pending', verifiedPurchase: true,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_reviews\.reviews/)
    expect(sql).toMatch(/COALESCE\(\$10, 'published'\)/)
    expect(sql).toMatch(/COALESCE\(\$11, FALSE\)/)
    expect(params).toEqual([APP, TEN, 'product', 'sku', 'o1', UID, 5, 'T', 'B', 'pending', true])
    expect(out).toEqual({ id: RID })
  })

  it('applies nullish defaults when optionals absent', async () => {
    const c = mockClient([{ id: RID }])
    await repo.insert(c, APP, TEN, { targetType: 'vendor', targetId: 'v', buyerUserId: UID, rating: 4 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'vendor', 'v', null, UID, 4, null, null, null, false])
  })
})

describe('findById', () => {
  it('tenant scoped; missing → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, APP, TEN, RID)).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID])
  })

  it('returns row', async () => {
    const c = mockClient([{ id: RID }])
    expect(await repo.findById(c, APP, TEN, RID)).toEqual({ id: RID })
  })
})

describe('listByTarget', () => {
  it('defaults status=published, no verified filter, limit/offset at tail', async () => {
    const c = mockClient([])
    await repo.listByTarget(c, APP, TEN, { targetType: 'product', targetId: 'sku' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/verified_purchase = TRUE/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(sql).toMatch(/LIMIT \$6 OFFSET \$7/)
    expect(params).toEqual([APP, TEN, 'product', 'sku', 'published', 50, 0])
  })

  it('verifiedOnly adds clause; custom status/limit/offset', async () => {
    const c = mockClient([])
    await repo.listByTarget(c, APP, TEN, {
      targetType: 'vendor', targetId: 'v', status: 'hidden', verifiedOnly: true, limit: 10, offset: 20,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/verified_purchase = TRUE/)
    expect(params).toEqual([APP, TEN, 'vendor', 'v', 'hidden', 10, 20])
  })
})

describe('aggregate', () => {
  it('rating histogram + verified count, scoped to published', async () => {
    const c = mockClient([{ total: 3, average: 4.5 }])
    const out = await repo.aggregate(c, APP, TEN, { targetType: 'product', targetId: 'sku' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE rating = 5\)::int AS r5/)
    expect(sql).toMatch(/verified_purchase = TRUE\)::int AS verified_count/)
    expect(sql).toMatch(/status='published'/)
    expect(params).toEqual([APP, TEN, 'product', 'sku'])
    expect(out).toEqual({ total: 3, average: 4.5 })
  })
})

describe('setStatus', () => {
  it('UPDATE scoped; missing → null', async () => {
    const c = mockClient([])
    expect(await repo.setStatus(c, APP, TEN, RID, 'hidden')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4, updated_at=now\(\)/)
    expect(params).toEqual([APP, TEN, RID, 'hidden'])
  })

  it('returns updated row', async () => {
    const c = mockClient([{ id: RID, status: 'hidden' }])
    expect(await repo.setStatus(c, APP, TEN, RID, 'hidden')).toEqual({ id: RID, status: 'hidden' })
  })
})

describe('deleteById', () => {
  it('true when deleted, false otherwise', async () => {
    expect(await repo.deleteById(mockClient([], 1), APP, TEN, RID)).toBe(true)
    expect(await repo.deleteById(mockClient([], 0), APP, TEN, RID)).toBe(false)
  })
})

describe('upsertVote', () => {
  it('INSERT ... ON CONFLICT DO UPDATE vote_value', async () => {
    const c = mockClient([{ id: 'v1' }])
    await repo.upsertVote(c, APP, TEN, RID, UID, 1)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_reviews\.review_votes/)
    expect(sql).toMatch(/ON CONFLICT \(review_id, voter_user_id\) DO UPDATE/)
    expect(params).toEqual([APP, TEN, RID, UID, 1])
  })
})

describe('deleteVote', () => {
  it('true/false by rowCount', async () => {
    expect(await repo.deleteVote(mockClient([], 1), APP, TEN, RID, UID)).toBe(true)
    const c = mockClient([], 0)
    expect(await repo.deleteVote(c, APP, TEN, RID, UID)).toBe(false)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID, UID])
  })
})

describe('recomputeVoteCounts', () => {
  it('UPDATE recomputes helpful/unhelpful; missing → null', async () => {
    const c = mockClient([])
    expect(await repo.recomputeVoteCounts(c, APP, TEN, RID)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET helpful_count = \(/)
    expect(sql).toMatch(/RETURNING helpful_count, unhelpful_count/)
    expect(params).toEqual([APP, TEN, RID])
  })

  it('returns counts row', async () => {
    const c = mockClient([{ helpful_count: 3, unhelpful_count: 1 }])
    expect(await repo.recomputeVoteCounts(c, APP, TEN, RID)).toEqual({ helpful_count: 3, unhelpful_count: 1 })
  })
})

describe('insertMedia', () => {
  it('INSERT with COALESCE display_order default 0', async () => {
    const c = mockClient([{ id: 'm1' }])
    await repo.insertMedia(c, APP, TEN, RID, { objectId: 'obj', kind: 'photo' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/COALESCE\(\$6, 0\)/)
    expect(params).toEqual([APP, TEN, RID, 'obj', 'photo', 0])
  })

  it('passes explicit display_order', async () => {
    const c = mockClient([{ id: 'm1' }])
    await repo.insertMedia(c, APP, TEN, RID, { objectId: 'obj', kind: 'video', displayOrder: 5 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID, 'obj', 'video', 5])
  })
})

describe('listMedia', () => {
  it('scoped + ordered by display_order, created_at', async () => {
    const c = mockClient([{ id: 'm1' }])
    const out = await repo.listMedia(c, APP, TEN, RID)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY display_order, created_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID])
    expect(out).toEqual([{ id: 'm1' }])
  })
})

describe('deleteMedia', () => {
  it('true/false by rowCount', async () => {
    expect(await repo.deleteMedia(mockClient([], 1), APP, TEN, 'm1')).toBe(true)
    expect(await repo.deleteMedia(mockClient([], 0), APP, TEN, 'm1')).toBe(false)
  })
})

describe('insertReply', () => {
  it('INSERT reply scoped', async () => {
    const c = mockClient([{ id: 'rp1' }])
    await repo.insertReply(c, APP, TEN, RID, 'vendor1', 'thanks')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_reviews\.review_replies/)
    expect(params).toEqual([APP, TEN, RID, 'vendor1', 'thanks'])
  })
})

describe('listReplies', () => {
  it('scoped + ordered ASC', async () => {
    const c = mockClient([{ id: 'rp1' }])
    const out = await repo.listReplies(c, APP, TEN, RID)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at ASC/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID])
    expect(out).toEqual([{ id: 'rp1' }])
  })
})
