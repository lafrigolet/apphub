import { randomUUID } from 'node:crypto'
import { pool, withTenantTransaction } from '../lib/db.js'
import { stripe, isStubbed } from '../lib/stripe.js'
import { checkIdempotency, storeIdempotency, publish } from '../lib/redis.js'
import * as txRepo from '../repositories/transaction.repository.js'
import * as refundRepo from '../repositories/refund.repository.js'
import { AppError, ValidationError, ConflictError } from '@apphub/platform-sdk/errors'
import { logger } from '../lib/logger.js'

class StripeError extends AppError {
  constructor(message, details = undefined) {
    super('STRIPE_ERROR', message, 502, details)
    this.name = 'StripeError'
  }
}

function tenantTx(ctx, fn) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, fn)
}

async function emit(ctx, type, payload) {
  try {
    await publish({ type, payload: { appId: ctx.appId, tenantId: ctx.tenantId, ...payload } })
  } catch (err) {
    logger.error({ err, type }, 'Failed to publish payments event')
  }
}

// ── Create PaymentIntent (one-shot) ──────────────────────────────────────────
export async function createPaymentIntent(ctx, input) {
  // Idempotency: a retried request returns the original result without ever
  // calling Stripe again (CLAUDE.md §3).
  const cached = await checkIdempotency(idemScope(ctx, input.idempotencyKey))
  if (cached) return JSON.parse(cached)

  const currency = input.currency ?? 'eur'
  const stub = isStubbed()

  let providerTxId, clientSecret, status
  if (stub) {
    // Dev-stub: no Stripe credentials configured. Mint a deterministic fake
    // intent so local/dev flows work end-to-end without real charges.
    providerTxId = `pi_stub_${randomUUID().replace(/-/g, '')}`
    clientSecret = `${providerTxId}_secret_stub`
    status = input.captureMethod === 'manual' ? 'requires_capture' : 'requires_payment_method'
  } else {
    let intent
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency,
          capture_method: input.captureMethod ?? 'automatic',
          ...(input.setupFutureUsage ? { setup_future_usage: input.setupFutureUsage } : {}),
          automatic_payment_methods: { enabled: true },
          metadata: {
            app_id: ctx.appId,
            tenant_id: ctx.tenantId,
            sub_tenant_id: ctx.subTenantId ?? '',
            user_id: input.userId,
            ...input.metadata,
          },
        },
        { idempotencyKey: `pi_${idemScope(ctx, input.idempotencyKey)}` },
      )
    } catch (err) {
      logger.error({ err }, 'Stripe PaymentIntent creation failed')
      throw new StripeError('Failed to create payment intent', err.message)
    }
    providerTxId = intent.id
    clientSecret = intent.client_secret
    status = mapIntentStatus(intent.status)
  }

  const tx = await tenantTx(ctx, (client) => txRepo.insertTransaction(client, ctx, {
    userId: input.userId,
    provider: 'stripe',
    providerTxId,
    amountCents: input.amount,
    currency,
    status,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
  }))

  const result = { transactionId: tx.id, providerTxId, clientSecret, status, stub }
  await storeIdempotency(idemScope(ctx, input.idempotencyKey), result)
  await emit(ctx, 'payment.intent.created', { transactionId: tx.id, providerTxId, amountCents: input.amount, currency, status })
  return result
}

export async function getIntent(ctx, id) {
  return tenantTx(ctx, (client) => txRepo.findById(client, ctx, id))
}

export async function listIntents(ctx, { limit, cursor, status }) {
  return tenantTx(ctx, async (client) => {
    const items = await txRepo.listTransactions(client, ctx, { limit: limit + 1, cursor, status })
    const hasMore = items.length > limit
    const data = hasMore ? items.slice(0, limit) : items
    return { data, cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null, hasMore }
  })
}

// ── Cancel a non-captured PaymentIntent (release authorization hold) ──────────
export async function cancelIntent(ctx, id) {
  const tx = await tenantTx(ctx, (client) => txRepo.findById(client, ctx, id))
  if (['succeeded', 'canceled'].includes(tx.status)) {
    throw new ConflictError(`Cannot cancel a ${tx.status} payment`)
  }
  if (!isStubbed() && tx.providerTxId && !tx.providerTxId.startsWith('pi_stub_')) {
    try {
      await stripe.paymentIntents.cancel(tx.providerTxId)
    } catch (err) {
      throw new StripeError('Failed to cancel payment intent', err.message)
    }
  }
  const updated = await tenantTx(ctx, (client) => txRepo.updateStatus(client, ctx, id, 'canceled'))
  await emit(ctx, 'payment.intent.canceled', { transactionId: id, providerTxId: tx.providerTxId })
  return updated
}

// ── Capture a previously-authorized PaymentIntent (manual capture) ────────────
export async function captureIntent(ctx, id, amountToCapture) {
  const tx = await tenantTx(ctx, (client) => txRepo.findById(client, ctx, id))
  if (tx.status !== 'requires_capture') {
    throw new ConflictError(`Cannot capture a payment in status ${tx.status}`)
  }
  if (amountToCapture != null && amountToCapture > tx.amountCents) {
    throw new ValidationError('amountToCapture exceeds the authorized amount')
  }
  if (!isStubbed() && tx.providerTxId && !tx.providerTxId.startsWith('pi_stub_')) {
    try {
      await stripe.paymentIntents.capture(
        tx.providerTxId,
        amountToCapture != null ? { amount_to_capture: amountToCapture } : {},
        { idempotencyKey: `cap_${tx.id}` },
      )
    } catch (err) {
      throw new StripeError('Failed to capture payment intent', err.message)
    }
  }
  const updated = await tenantTx(ctx, (client) => txRepo.updateStatus(client, ctx, id, 'succeeded'))
  await emit(ctx, 'payment.captured', { transactionId: id, providerTxId: tx.providerTxId })
  return updated
}

// ── Refunds (total / partial, cumulative-safe) ───────────────────────────────
export async function createRefund(ctx, transactionId, input) {
  const cached = await checkIdempotency(idemScope(ctx, input.idempotencyKey))
  if (cached) return JSON.parse(cached)

  const tx = await tenantTx(ctx, (client) => txRepo.findById(client, ctx, transactionId))
  if (tx.status !== 'succeeded') {
    throw new ConflictError('Only succeeded payments can be refunded')
  }

  const alreadyRefunded = await tenantTx(ctx, (client) => refundRepo.sumRefundedCents(client, ctx, transactionId))
  const remaining = tx.amountCents - alreadyRefunded
  const amount = input.amount ?? remaining
  if (amount <= 0) throw new ValidationError('No refundable amount remaining')
  if (amount > remaining) throw new ValidationError('Refund amount exceeds the remaining refundable amount')

  const stub = isStubbed()
  let providerRefundId, status
  if (stub || !tx.providerTxId || tx.providerTxId.startsWith('pi_stub_')) {
    providerRefundId = `re_stub_${randomUUID().replace(/-/g, '')}`
    status = 'succeeded'
  } else {
    let refund
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: tx.providerTxId,
          amount,
          ...(input.reason ? { reason: input.reason } : {}),
          metadata: {
            app_id: ctx.appId,
            tenant_id: ctx.tenantId,
            sub_tenant_id: ctx.subTenantId ?? '',
            transaction_id: transactionId,
          },
        },
        { idempotencyKey: `ref_${idemScope(ctx, input.idempotencyKey)}` },
      )
    } catch (err) {
      throw new StripeError('Failed to create refund', err.message)
    }
    providerRefundId = refund.id
    status = refund.status ?? 'pending'
  }

  const refundRow = await tenantTx(ctx, (client) => refundRepo.insertRefund(client, ctx, {
    transactionId,
    providerRefundId,
    amountCents: amount,
    currency: tx.currency,
    reason: input.reason,
    status,
    idempotencyKey: input.idempotencyKey,
    createdByUserId: ctx.userId,
  }))

  // Mark the transaction refunded/partially_refunded for reporting.
  const fullyRefunded = alreadyRefunded + amount >= tx.amountCents
  await tenantTx(ctx, (client) => txRepo.updateStatus(client, ctx, transactionId, fullyRefunded ? 'refunded' : 'partially_refunded'))

  const result = { refundId: refundRow.id, providerRefundId, amountCents: amount, status, stub }
  await storeIdempotency(idemScope(ctx, input.idempotencyKey), result)
  await emit(ctx, 'payment.refunded', { transactionId, refundId: refundRow.id, amountCents: amount, fullyRefunded })
  return result
}

export async function listRefunds(ctx, transactionId) {
  return tenantTx(ctx, async (client) => {
    await txRepo.findById(client, ctx, transactionId) // 404 if not in tenant
    return refundRepo.listByTransaction(client, ctx, transactionId)
  })
}

// Scope the caller-supplied idempotency key by tenant so two tenants can reuse
// the same key without colliding (matches the DB unique index).
function idemScope(ctx, key) {
  return `${ctx.appId}:${ctx.tenantId}:${key}`
}

// Map a few Stripe PaymentIntent statuses onto our coarser lifecycle. Unknown
// statuses pass through verbatim so the webhook can sync the exact state later.
function mapIntentStatus(stripeStatus) {
  return stripeStatus ?? 'pending'
}

export { StripeError }
