import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/reviews.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

export async function createReview(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    try {
      const review = await repo.insert(c, ctx.appId, ctx.tenantId, {
        ...input, buyerUserId: ctx.userId,
      })
      await publish({
        type: 'review.created',
        payload: {
          reviewId: review.id, appId: ctx.appId, tenantId: ctx.tenantId,
          targetType: review.target_type, targetId: review.target_id,
          rating: review.rating, buyerUserId: review.buyer_user_id,
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
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.aggregate(c, ctx.appId, ctx.tenantId, query),
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

export async function setStatus(ctx, id, status) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.setStatus(c, ctx.appId, ctx.tenantId, id, status)
    if (!r) throw new NotFoundError('review')
    if (status === 'hidden' || status === 'removed') {
      await publish({ type: 'review.hidden', payload: { reviewId: id, appId: ctx.appId, tenantId: ctx.tenantId, status } })
    }
    return r
  })
}

export async function remove(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ok = await repo.deleteById(c, ctx.appId, ctx.tenantId, id)
    if (!ok) throw new NotFoundError('review')
  })
}
