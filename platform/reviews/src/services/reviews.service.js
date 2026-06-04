import { pool, withTenantTransaction } from '../lib/db.js'
import { publish, redis } from '../lib/redis.js'
import * as repo from '../repositories/reviews.repository.js'
import { isVerifiedPurchase } from '../lib/orders-client.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

// Aggregate cache (recommendation #5). Aggregates are read on every PDP load
// but only change when a review is created / moderated / deleted, so we cache
// the computed row in Redis and invalidate on those mutations. TTL is a safety
// net in case an invalidation is ever missed.
const AGG_CACHE_TTL_SECONDS = 300

// Number of distinct open abuse reports that auto-hides a review (recommendation
// #9 — threshold-based quarantine, kept local: no scheduler needed).
const AUTO_HIDE_REPORT_THRESHOLD = 3

function aggCacheKey(appId, tenantId, targetType, targetId) {
  return `reviews:agg:${appId}:${tenantId}:${targetType}:${targetId}`
}

async function invalidateAggCache(appId, tenantId, targetType, targetId) {
  if (!targetType || !targetId) return
  try {
    await redis.del(aggCacheKey(appId, tenantId, targetType, targetId))
  } catch {
    // Cache invalidation is best-effort; the TTL bounds staleness anyway.
  }
}

export async function createReview(ctx, input) {
  // Verified-purchase: if the review carries an orderId AND the caller's JWT
  // resolves to an order owned by the same buyer in a post-payment status,
  // mark the review as verified. The check is soft-fail — if orders is down
  // or times out, we still save the review with verified_purchase=false.
  const verifiedPurchase = await isVerifiedPurchase(input.orderId, ctx.userId, ctx.jwt)

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    try {
      const review = await repo.insert(c, ctx.appId, ctx.tenantId, {
        ...input, buyerUserId: ctx.userId, verifiedPurchase,
      })
      await invalidateAggCache(ctx.appId, ctx.tenantId, review.target_type, review.target_id)
      await publish({
        type: 'review.created',
        payload: {
          reviewId: review.id, appId: ctx.appId, tenantId: ctx.tenantId,
          targetType: review.target_type, targetId: review.target_id,
          rating: review.rating, buyerUserId: review.buyer_user_id,
          verifiedPurchase: review.verified_purchase,
        },
      })
      return review
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('review already exists for this buyer/target/order')
      throw err
    }
  })
}

export async function getReview(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!review) throw new NotFoundError('review')
    const replies = await repo.listReplies(c, ctx.appId, ctx.tenantId, id)
    return { ...review, replies }
  })
}

export async function listByTarget(ctx, query) {
  if (!query.targetType || !query.targetId) throw new ValidationError('targetType and targetId required')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTarget(c, ctx.appId, ctx.tenantId, query),
  )
}

export async function aggregateForTarget(ctx, query) {
  if (!query.targetType || !query.targetId) throw new ValidationError('targetType and targetId required')
  const key = aggCacheKey(ctx.appId, ctx.tenantId, query.targetType, query.targetId)
  try {
    const cached = await redis.get(key)
    if (cached) return JSON.parse(cached)
  } catch {
    // Cache miss / Redis down → fall through to the DB.
  }
  const agg = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.aggregate(c, ctx.appId, ctx.tenantId, query),
  )
  try {
    await redis.set(key, JSON.stringify(agg), 'EX', AGG_CACHE_TTL_SECONDS)
  } catch {
    // Best-effort cache write.
  }
  return agg
}

// Staff moderation queue (recommendation #7).
export async function listForModeration(ctx, query) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listForModeration(c, ctx.appId, ctx.tenantId, query),
  )
}

export async function reply(ctx, reviewId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, reviewId)
    if (!review) throw new NotFoundError('review')
    const r = await repo.insertReply(c, ctx.appId, ctx.tenantId, reviewId, ctx.userId, body)
    await publish({
      type: 'review.replied',
      payload: { reviewId, replyId: r.id, appId: ctx.appId, tenantId: ctx.tenantId, buyerUserId: review.buyer_user_id },
    })
    return r
  })
}

export async function setStatus(ctx, id, status, moderationReason = null) {
  const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const updated = await repo.setStatus(c, ctx.appId, ctx.tenantId, id, status, moderationReason)
    if (!updated) throw new NotFoundError('review')
    if (status === 'hidden' || status === 'removed') {
      await publish({
        type: 'review.hidden',
        payload: { reviewId: id, appId: ctx.appId, tenantId: ctx.tenantId, status, moderationReason: moderationReason ?? null },
      })
    }
    return updated
  })
  // A status change can flip a review in/out of the published aggregate.
  await invalidateAggCache(ctx.appId, ctx.tenantId, r.target_type, r.target_id)
  return r
}

export async function remove(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    const ok = await repo.deleteById(c, ctx.appId, ctx.tenantId, id)
    if (!ok) throw new NotFoundError('review')
    if (review) await invalidateAggCache(ctx.appId, ctx.tenantId, review.target_type, review.target_id)
  })
}

// ── Reports / abuse flags (recommendation #9) ────────────────────────────

export async function report(ctx, reviewId, reason, detail) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, reviewId)
    if (!review) throw new NotFoundError('review')
    const report = await repo.upsertReport(c, ctx.appId, ctx.tenantId, reviewId, ctx.userId, reason, detail)
    const openCount = await repo.countOpenReports(c, ctx.appId, ctx.tenantId, reviewId)

    await publish({
      type: 'review.reported',
      payload: {
        reviewId, reportId: report.id, appId: ctx.appId, tenantId: ctx.tenantId,
        reason, openCount, buyerUserId: review.buyer_user_id,
      },
    })

    // Auto-quarantine: once the open-report threshold is crossed and the
    // review is still publicly visible, hide it pending staff review.
    let autoHidden = false
    if (openCount >= AUTO_HIDE_REPORT_THRESHOLD && review.status === 'published') {
      await repo.setStatus(c, ctx.appId, ctx.tenantId, reviewId, 'hidden', 'auto-hidden: report threshold reached')
      autoHidden = true
      await invalidateAggCache(ctx.appId, ctx.tenantId, review.target_type, review.target_id)
      await publish({
        type: 'review.hidden',
        payload: { reviewId, appId: ctx.appId, tenantId: ctx.tenantId, status: 'hidden', moderationReason: 'auto-hidden: report threshold reached' },
      })
    }

    return { ...report, openCount, autoHidden }
  })
}

export async function listReports(ctx, query) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listReports(c, ctx.appId, ctx.tenantId, query),
  )
}

export async function setReportStatus(ctx, reportId, status) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.setReportStatus(c, ctx.appId, ctx.tenantId, reportId, status)
    if (!r) throw new NotFoundError('report')
    return r
  })
}

// ── Voting (helpful / unhelpful) ─────────────────────────────────────────

export async function vote(ctx, reviewId, voteValue) {
  if (![-1, 1].includes(voteValue)) throw new ValidationError('voteValue must be -1 or 1')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, reviewId)
    if (!review) throw new NotFoundError('review')
    if (review.buyer_user_id === ctx.userId) {
      throw new ConflictError('cannot vote on your own review')
    }
    await repo.upsertVote(c, ctx.appId, ctx.tenantId, reviewId, ctx.userId, voteValue)
    return repo.recomputeVoteCounts(c, ctx.appId, ctx.tenantId, reviewId)
  })
}

export async function unvote(ctx, reviewId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, reviewId)
    if (!review) throw new NotFoundError('review')
    await repo.deleteVote(c, ctx.appId, ctx.tenantId, reviewId, ctx.userId)
    return repo.recomputeVoteCounts(c, ctx.appId, ctx.tenantId, reviewId)
  })
}

// ── Media (photo/video) ─────────────────────────────────────────────────

export async function attachMedia(ctx, reviewId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const review = await repo.findById(c, ctx.appId, ctx.tenantId, reviewId)
    if (!review) throw new NotFoundError('review')
    if (review.buyer_user_id !== ctx.userId && !['staff', 'super_admin'].includes(ctx.role)) {
      throw new ConflictError('only the review author can attach media')
    }
    return repo.insertMedia(c, ctx.appId, ctx.tenantId, reviewId, body)
  })
}

export async function listMedia(ctx, reviewId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listMedia(c, ctx.appId, ctx.tenantId, reviewId),
  )
}

export async function detachMedia(ctx, mediaId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ok = await repo.deleteMedia(c, ctx.appId, ctx.tenantId, mediaId)
    if (!ok) throw new NotFoundError('media')
  })
}

// ── Schema.org JSON-LD (SEO) ─────────────────────────────────────────────
//
// Returns an aggregateRating + a few sample reviews shaped according to
// schema.org/Product. Frontends can drop this directly into a
// <script type="application/ld+json"> tag on PDP pages so Google / Bing
// surface star ratings in SERP. We deliberately don't embed PII (no
// reviewer email/full name); only the rating, title, and body excerpt.
export async function jsonLd(ctx, query) {
  if (!query.targetType || !query.targetId) throw new ValidationError('targetType and targetId required')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const agg     = await repo.aggregate(c, ctx.appId, ctx.tenantId, query)
    const reviews = await repo.listByTarget(c, ctx.appId, ctx.tenantId, { ...query, status: 'published', limit: 10, offset: 0 })

    const isProduct = query.targetType === 'product'
    const root = {
      '@context': 'https://schema.org',
      '@type':    isProduct ? 'Product' : 'Organization',
      name:       query.targetName ?? query.targetId,
      ...(isProduct ? { sku: query.targetId } : { identifier: query.targetId }),
    }
    if (Number(agg.count) > 0) {
      root.aggregateRating = {
        '@type':       'AggregateRating',
        ratingValue:   Number(agg.average),
        reviewCount:   Number(agg.count),
        bestRating:    5,
        worstRating:   1,
      }
    }
    if (reviews.length > 0) {
      root.review = reviews.map((r) => ({
        '@type':         'Review',
        reviewRating:    { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
        author:          { '@type': 'Person', name: 'Verified buyer' },
        reviewBody:      (r.body || '').slice(0, 1000),
        ...(r.title ? { name: r.title } : {}),
        datePublished:   new Date(r.created_at).toISOString().slice(0, 10),
      }))
    }
    return root
  })
}
