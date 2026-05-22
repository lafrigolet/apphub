// reviews.service — voting + media + jsonLd (SEO).
// Cubre los caminos NO testeados en reviews.service.test.js (vote/unvote
// y attachMedia/detachMedia/listMedia + Schema.org JSON-LD).
//
// Contrato vote:
//   - voteValue debe ser -1 o 1 (else ValidationError).
//   - review no existe → NotFoundError.
//   - buyer NO puede votar su propia review → ConflictError.
//   - happy → upsertVote + recomputeVoteCounts.
//
// Contrato unvote:
//   - review no existe → NotFoundError.
//   - deleteVote + recompute.
//
// Contrato attachMedia:
//   - solo author (o staff) → ConflictError si otro user.
//   - review no existe → NotFoundError.
//
// Contrato detachMedia:
//   - mediaId no existe → NotFoundError 404.
//
// Contrato jsonLd:
//   - targetType/targetId required → ValidationError.
//   - Product vs Organization @type.
//   - count > 0 → incluye aggregateRating con ratingValue + reviewCount.
//   - count = 0 → NO incluye aggregateRating (anti SEO fake).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/reviews.repository.js')

import {
  vote, unvote, attachMedia, detachMedia, listMedia, jsonLd,
} from '../services/reviews.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/reviews.repository.js'

const ctx = (overrides = {}) => ({
  appId: 'shop', tenantId: 't1', subTenantId: null,
  userId: 'buyer-1', role: 'user', ...overrides,
})
const REVIEW = 'rev-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── vote ────────────────────────────────────────────────────────────

describe('vote', () => {
  it.each([[0], [2], [-2], [0.5], ['1'], [null]])(
    'voteValue %s → ValidationError 422',
    async (v) => {
      await expect(vote(ctx(), REVIEW, v)).rejects.toMatchObject({ statusCode: 422 })
    },
  )

  it('review no existe → NotFoundError 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(vote(ctx(), REVIEW, 1)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('buyer.userId === own review.buyer_user_id → ConflictError "cannot vote on your own"', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW, buyer_user_id: 'buyer-1' })
    await expect(vote(ctx({ userId: 'buyer-1' }), REVIEW, 1)).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('your own review'),
    })
    expect(repo.upsertVote).not.toHaveBeenCalled()
  })

  it('happy: vote=+1 → upsert + recompute, retorna nueva agregación', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW, buyer_user_id: 'other-buyer' })
    repo.recomputeVoteCounts.mockResolvedValue({ helpful: 5, unhelpful: 1 })
    const r = await vote(ctx(), REVIEW, 1)
    expect(repo.upsertVote).toHaveBeenCalledWith(expect.anything(), 'shop', 't1', REVIEW, 'buyer-1', 1)
    expect(repo.recomputeVoteCounts).toHaveBeenCalledWith(expect.anything(), 'shop', 't1', REVIEW)
    expect(r.helpful).toBe(5)
  })

  it('vote=-1 (unhelpful) propaga al repo', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW, buyer_user_id: 'other' })
    repo.recomputeVoteCounts.mockResolvedValue({ helpful: 0, unhelpful: 1 })
    await vote(ctx(), REVIEW, -1)
    expect(repo.upsertVote.mock.calls[0][5]).toBe(-1)
  })
})

// ── unvote ──────────────────────────────────────────────────────────

describe('unvote', () => {
  it('review no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(unvote(ctx(), REVIEW)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: deleteVote + recompute (no-op si el user nunca votó)', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW })
    repo.recomputeVoteCounts.mockResolvedValue({ helpful: 2, unhelpful: 0 })
    await unvote(ctx(), REVIEW)
    expect(repo.deleteVote).toHaveBeenCalledWith(expect.anything(), 'shop', 't1', REVIEW, 'buyer-1')
  })
})

// ── attachMedia / detachMedia / listMedia ──────────────────────────

describe('attachMedia', () => {
  it('review no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(attachMedia(ctx(), REVIEW, { objectId: 'obj-1' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('user que NO es author ni staff → ConflictError', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW, buyer_user_id: 'someone-else' })
    await expect(attachMedia(ctx({ userId: 'attacker' }), REVIEW, { objectId: 'obj-1' }))
      .rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining('only the review author'),
      })
  })

  it('original author → puede adjuntar', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW, buyer_user_id: 'buyer-1' })
    repo.insertMedia.mockResolvedValue({ id: 'media-1' })
    await attachMedia(ctx(), REVIEW, { objectId: 'obj-1', kind: 'photo' })
    expect(repo.insertMedia).toHaveBeenCalledWith(
      expect.anything(), 'shop', 't1', REVIEW, { objectId: 'obj-1', kind: 'photo' },
    )
  })

  it('staff (no author) → puede adjuntar (moderación)', async () => {
    repo.findById.mockResolvedValue({ id: REVIEW, buyer_user_id: 'other' })
    repo.insertMedia.mockResolvedValue({ id: 'media-1' })
    await attachMedia(ctx({ userId: 'staff-1', role: 'staff' }), REVIEW, { objectId: 'o' })
    expect(repo.insertMedia).toHaveBeenCalled()
  })
})

describe('detachMedia', () => {
  it('media no existe → NotFoundError', async () => {
    repo.deleteMedia.mockResolvedValue(false)
    await expect(detachMedia(ctx(), 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: delega al repo', async () => {
    repo.deleteMedia.mockResolvedValue(true)
    await expect(detachMedia(ctx(), 'media-1')).resolves.toBeUndefined()
  })
})

describe('listMedia', () => {
  it('delega al repo (sin guard — público de la review)', async () => {
    repo.listMedia.mockResolvedValue([{ id: 'm1' }])
    const r = await listMedia(ctx(), REVIEW)
    expect(r).toHaveLength(1)
  })
})

// ── jsonLd (Schema.org SEO) ────────────────────────────────────────

describe('jsonLd', () => {
  it('targetType/targetId required → ValidationError', async () => {
    await expect(jsonLd(ctx(), {})).rejects.toMatchObject({ statusCode: 422 })
    await expect(jsonLd(ctx(), { targetType: 'product' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('targetType="product" → @type "Product" + sku=targetId', async () => {
    repo.aggregate.mockResolvedValue({ count: 0, average: 0 })
    repo.listByTarget.mockResolvedValue([])
    const r = await jsonLd(ctx(), { targetType: 'product', targetId: 'sku-1', targetName: 'My Product' })
    expect(r['@type']).toBe('Product')
    expect(r.sku).toBe('sku-1')
    expect(r.name).toBe('My Product')
  })

  it('targetType="vendor" → @type "Organization" + identifier=targetId', async () => {
    repo.aggregate.mockResolvedValue({ count: 0, average: 0 })
    repo.listByTarget.mockResolvedValue([])
    const r = await jsonLd(ctx(), { targetType: 'vendor', targetId: 'vendor-1', targetName: 'V' })
    expect(r['@type']).toBe('Organization')
    expect(r.identifier).toBe('vendor-1')
    expect(r.sku).toBeUndefined()
  })

  it('count = 0 → SIN aggregateRating (anti SEO con 0 reviews)', async () => {
    repo.aggregate.mockResolvedValue({ count: 0, average: 0 })
    repo.listByTarget.mockResolvedValue([])
    const r = await jsonLd(ctx(), { targetType: 'product', targetId: 's' })
    expect(r.aggregateRating).toBeUndefined()
  })

  it('count > 0 → aggregateRating con ratingValue + reviewCount', async () => {
    repo.aggregate.mockResolvedValue({ count: 17, average: 4.3 })
    repo.listByTarget.mockResolvedValue([])
    const r = await jsonLd(ctx(), { targetType: 'product', targetId: 's' })
    expect(r.aggregateRating).toMatchObject({
      '@type': 'AggregateRating',
      ratingValue: 4.3,
      reviewCount: 17,
    })
  })

  it('targetName ausente → fallback a targetId', async () => {
    repo.aggregate.mockResolvedValue({ count: 0, average: 0 })
    repo.listByTarget.mockResolvedValue([])
    const r = await jsonLd(ctx(), { targetType: 'product', targetId: 'sku-1' })
    expect(r.name).toBe('sku-1')
  })

  it('limit = 10 hard-coded en el lookup (anti volcado de TODA la BD)', async () => {
    repo.aggregate.mockResolvedValue({ count: 0, average: 0 })
    repo.listByTarget.mockResolvedValue([])
    await jsonLd(ctx(), { targetType: 'product', targetId: 's' })
    expect(repo.listByTarget).toHaveBeenCalledWith(
      expect.anything(), 'shop', 't1',
      expect.objectContaining({ limit: 10, offset: 0, status: 'published' }),
    )
  })
})
