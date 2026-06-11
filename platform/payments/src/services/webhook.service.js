import { stripe, getWebhookSecret } from '../lib/stripe.js'
import { pool, withTenantTransaction, withTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as txRepo from '../repositories/transaction.repository.js'
import * as refundRepo from '../repositories/refund.repository.js'
import * as eventRepo from '../repositories/webhook-event.repository.js'
import { logger } from '../lib/logger.js'

export async function constructWebhookEvent(payload, signature) {
  const secret = await getWebhookSecret()
  if (!secret) throw new Error('Stripe webhook secret not configured (set platform_payments.config.stripe_webhook_secret)')
  return stripe.webhooks.constructEvent(payload, signature, secret)
}

// Returns false if the event was already seen (Stripe replay) — caller drops it.
async function dedupe(event) {
  return withTransaction(pool, (client) => eventRepo.recordReceived(client, event.id, event.type))
}

export async function handleWebhookEvent(event) {
  const fresh = await dedupe(event)
  if (!fresh) {
    logger.info({ eventId: event.id, type: event.type }, 'Duplicate webhook event — dropped')
    return
  }
  logger.info({ eventId: event.id, type: event.type }, 'Processing webhook event')
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await syncIntent(event.data.object, 'succeeded', 'payment.succeeded')
        break
      case 'payment_intent.payment_failed':
        await syncIntent(event.data.object, 'failed', 'payment.failed',
          event.data.object.last_payment_error?.code ?? null)
        break
      case 'payment_intent.canceled':
        await syncIntent(event.data.object, 'canceled', 'payment.intent.canceled')
        break
      case 'payment_intent.requires_action':
        await syncIntent(event.data.object, 'requires_action', 'payment.requires_action')
        break
      case 'charge.refund.updated':
        await syncRefund(event.data.object)
        break
      case 'checkout.session.completed':
        await syncCheckout(event.data.object)
        break
      default:
        logger.debug({ type: event.type }, 'Unhandled webhook event type')
    }
    await withTransaction(pool, (client) => eventRepo.markProcessed(client, event.id))
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, 'Webhook handler failed')
    await withTransaction(pool, (client) => eventRepo.markFailed(client, event.id, err.message))
    throw err
  }
}

// Resolve tenant context from the intent metadata (we always stamp app_id /
// tenant_id when creating the intent) so the RLS-scoped UPDATE can run.
function ctxFromMetadata(meta) {
  if (!meta?.app_id || !meta?.tenant_id) return null
  return { appId: meta.app_id, tenantId: meta.tenant_id, subTenantId: meta.sub_tenant_id || null }
}

async function syncIntent(intent, status, eventType, errorCode = null) {
  const ctx = ctxFromMetadata(intent.metadata)
  if (!ctx) {
    logger.warn({ intentId: intent.id }, 'PaymentIntent webhook without tenant metadata — cannot scope update')
    return
  }
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId,
    (client) => txRepo.updateStatusByProviderTxId(client, intent.id, status, errorCode))
  if (!updated) {
    logger.warn({ intentId: intent.id }, 'PaymentIntent webhook for unknown transaction — ignoring')
    return
  }
  await emit(ctx, eventType, {
    transactionId: updated.id,
    providerTxId: intent.id,
    amountCents: updated.amountCents,
    currency: updated.currency,
    status,
    // source (p.ej. 'tap_to_pay') viaja para que consumidores como
    // platform/tpv puedan filtrar los cobros que deben generar recibo.
    source: updated.metadata?.source ?? null,
    ...(errorCode ? { errorCode } : {}),
  })
  logger.info({ intentId: intent.id, status }, 'PaymentIntent status synced')
}

// checkout.session.completed (path web / QR): la sesión Checkout no tiene una
// transacción nuestra previa (se crea hosted), así que solo emitimos el evento
// unificado payment.succeeded con el PI resultante. platform/tpv lo consume
// para crear el billing_fact + recibo (bill_id = PI id, idempotente).
async function syncCheckout(session) {
  const ctx = ctxFromMetadata(session.metadata)
  if (!ctx) {
    logger.warn({ sessionId: session.id }, 'checkout.session.completed without tenant metadata — ignoring')
    return
  }
  if (session.payment_status !== 'paid') {
    logger.info({ sessionId: session.id, paymentStatus: session.payment_status }, 'checkout session not paid — ignoring')
    return
  }
  await emit(ctx, 'payment.succeeded', {
    transactionId: null,
    providerTxId: session.payment_intent,
    amountCents: session.amount_total,
    currency: session.currency,
    status: 'succeeded',
    source: session.metadata?.source ?? null,
  })
  logger.info({ sessionId: session.id, pi: session.payment_intent }, 'Checkout session completed')
}

// charge.refund.updated: sync the refund row state by provider_refund_id. The
// refund carries app_id/tenant_id in its Stripe metadata (stamped at creation),
// so we can set the RLS context before the UPDATE.
async function syncRefund(refund) {
  const ctx = ctxFromMetadata(refund.metadata)
  if (!ctx) {
    logger.warn({ refundId: refund.id }, 'charge.refund.updated without tenant metadata — ignoring')
    return
  }
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId,
    (client) => refundRepo.updateStatusByProviderRefundId(client, refund.id, refund.status ?? 'succeeded'))
  if (!updated) {
    logger.warn({ refundId: refund.id }, 'charge.refund.updated for unknown refund — ignoring')
    return
  }
  await emit(ctx, 'payment.refund.updated', { refundId: updated.id, providerRefundId: refund.id, status: updated.status })
  logger.info({ refundId: refund.id, status: updated.status }, 'Refund status synced')
}

async function emit(ctx, type, payload) {
  try {
    await publish({ type, payload: { appId: ctx.appId, tenantId: ctx.tenantId, ...payload } })
  } catch (err) {
    logger.error({ err, type }, 'Failed to publish payments event')
  }
}
