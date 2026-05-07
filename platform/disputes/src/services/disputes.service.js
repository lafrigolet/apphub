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
    const before  = await repo.findById(c, ctx.appId, ctx.tenantId, id)
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

    // Auto-refund: when staff resolves in favour of the buyer with a
    // resolution amount, publish a refund-request event that splitpay
    // consumes (it owns the Stripe client + Connect transfers).
    // Idempotent: refund_requested_at is set the first time; only the
    // first transition into 'resolved_buyer' fires the event.
    const isFirstBuyerResolution =
      updated.status === 'resolved_buyer'
      && before?.status !== 'resolved_buyer'
      && Number(updated.resolution_amount_cents ?? 0) > 0
    if (isFirstBuyerResolution) {
      await repo.markRefundRequested(c, ctx.appId, ctx.tenantId, id)
      await publish({
        type: 'dispute.refund.requested',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId,
          disputeId: id, orderId: updated.order_id,
          amountCents: updated.resolution_amount_cents,
          stripeDisputeId: updated.stripe_dispute_id ?? null,
          requestedByUserId: ctx.userId,
        },
      })
    }
    return updated
  })
}

// Submit the internal evidence rows to Stripe (via splitpay, which owns the
// Stripe client). The dispute must already carry a stripe_dispute_id set
// when the chargeback webhook landed.
export async function submitEvidenceToStripe(ctx, id) {
  if (!['staff', 'super_admin'].includes(ctx.role)) throw new ForbiddenError('only staff can submit evidence')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const dispute = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!dispute) throw new NotFoundError('dispute')
    if (!dispute.stripe_dispute_id) {
      throw new ForbiddenError('dispute is not linked to a Stripe dispute (no stripe_dispute_id)')
    }
    const evidence = await repo.listEvidence(c, ctx.appId, ctx.tenantId, id)
    await repo.markEvidenceSubmitted(c, ctx.appId, ctx.tenantId, id)
    await publish({
      type: 'dispute.evidence.submit',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        disputeId: id, stripeDisputeId: dispute.stripe_dispute_id,
        evidence: evidence.map((e) => ({ kind: e.kind, data: e.data })),
        submittedByUserId: ctx.userId,
      },
    })
    return { ok: true, items: evidence.length }
  })
}

// Event consumer: a Stripe chargeback escalates the corresponding internal dispute.
// We also persist stripe_dispute_id so submitEvidenceToStripe can find it later.
export async function handleEvent(event) {
  try {
    if (event.type === 'splitpay.chargeback.created' && event.payload?.orderId) {
      const ctx = { appId: event.payload.appId, tenantId: event.payload.tenantId, subTenantId: null, userId: null, role: 'system' }
      await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
        const dispute = await repo.findByOrderId(c, ctx.appId, ctx.tenantId, event.payload.orderId)
        if (dispute) {
          await repo.updateStatus(c, ctx.appId, ctx.tenantId, dispute.id, { status: 'escalated_chargeback' })
          if (event.payload.stripeDisputeId) {
            await repo.setStripeDisputeId(c, ctx.appId, ctx.tenantId, dispute.id, event.payload.stripeDisputeId)
          }
        }
      })
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'disputes event handler error')
  }
}

// Event consumer for scheduler-driven SLA breach. Moves an 'open' dispute
// without vendor reply to 'investigating' so staff sees it in the queue;
// the actual SLA-flag stamp on the row is owned by the scheduler so this
// handler is just a status nudge.
export async function handleSlaBreached(event) {
  try {
    const p = event.payload ?? {}
    if (!p.appId || !p.tenantId || !p.disputeId) return
    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: null, role: 'system' }
    await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
      const dispute = await repo.findById(c, ctx.appId, ctx.tenantId, p.disputeId)
      if (!dispute || dispute.status !== 'open') return
      await repo.updateStatus(c, ctx.appId, ctx.tenantId, p.disputeId, { status: 'investigating' })
    })
  } catch (err) {
    logger.warn({ err }, 'handleSlaBreached error')
  }
}
