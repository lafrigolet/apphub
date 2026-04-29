import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/disputes.repository.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js'

export async function openDispute(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const existing = await repo.findByOrderId(c, ctx.appId, ctx.tenantId, input.orderId)
    if (existing) throw new ConflictError(`dispute already exists for order ${input.orderId}`)
    const d = await repo.insert(c, ctx.appId, ctx.tenantId, { ...input, buyerUserId: ctx.userId })
    await publish({
      type: 'dispute.opened',
      payload: { disputeId: d.id, orderId: input.orderId, appId: ctx.appId, tenantId: ctx.tenantId, buyerUserId: ctx.userId, reason: input.reason },
    })
    return d
  })
}

export async function getDispute(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const dispute = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!dispute) throw new NotFoundError('dispute')
    const messages = await repo.listMessages(c, ctx.appId, ctx.tenantId, id)
    const evidence = await repo.listEvidence(c, ctx.appId, ctx.tenantId, id)
    return { ...dispute, messages, evidence }
  })
}

export async function listDisputes(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTenant(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function postMessage(ctx, disputeId, body, attachments) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const dispute = await repo.findById(c, ctx.appId, ctx.tenantId, disputeId)
    if (!dispute) throw new NotFoundError('dispute')
    const senderRole = ['staff', 'super_admin'].includes(ctx.role) ? 'staff'
                     : dispute.buyer_user_id === ctx.userId ? 'buyer'
                     : 'vendor'
    const msg = await repo.insertMessage(c, ctx.appId, ctx.tenantId, disputeId, ctx.userId, senderRole, body, attachments ?? [])
    await publish({
      type: 'dispute.message',
      payload: { disputeId, messageId: msg.id, appId: ctx.appId, tenantId: ctx.tenantId, senderRole },
    })
    return msg
  })
}

export async function uploadEvidence(ctx, disputeId, kind, data) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const dispute = await repo.findById(c, ctx.appId, ctx.tenantId, disputeId)
    if (!dispute) throw new NotFoundError('dispute')
    return repo.insertEvidence(c, ctx.appId, ctx.tenantId, disputeId, kind, data, ctx.userId)
  })
}

export async function resolve(ctx, id, fields) {
  if (!['staff', 'super_admin'].includes(ctx.role)) throw new ForbiddenError('only staff can resolve disputes')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const updated = await repo.updateStatus(c, ctx.appId, ctx.tenantId, id, { ...fields, resolvedByUserId: ctx.userId })
    if (!updated) throw new NotFoundError('dispute')
    await publish({
      type: 'dispute.resolved',
      payload: {
        disputeId: id, orderId: updated.order_id, status: updated.status,
        appId: ctx.appId, tenantId: ctx.tenantId,
        resolutionAmountCents: updated.resolution_amount_cents,
      },
    })
    return updated
  })
}

// Event consumer: a Stripe chargeback escalates the corresponding internal dispute.
export async function handleEvent(event) {
  try {
    if (event.type === 'splitpay.chargeback.created' && event.payload?.orderId) {
      const ctx = { appId: event.payload.appId, tenantId: event.payload.tenantId, subTenantId: null, userId: null, role: 'system' }
      await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
        const dispute = await repo.findByOrderId(c, ctx.appId, ctx.tenantId, event.payload.orderId)
        if (dispute) {
          await repo.updateStatus(c, ctx.appId, ctx.tenantId, dispute.id, { status: 'escalated_chargeback' })
        }
      })
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'disputes event handler error')
  }
}
