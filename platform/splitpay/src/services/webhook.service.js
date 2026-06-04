import { stripe, getWebhookSecret } from '../lib/stripe.js'
import { pool } from '../lib/db.js'
import { redis } from '../lib/redis.js'
import { publish } from '@apphub/platform-sdk/redis'
import { logger } from '../lib/logger.js'
import * as paymentRepo from '../repositories/payment.repository.js'
import * as checkoutRepo from '../repositories/checkout-session.repository.js'
import { createAdditionalTransfers } from './payment.service.js'
import { syncAccountFromStripe } from './connect-account.service.js'

export async function constructWebhookEvent(payload, signature) {
  const secret = await getWebhookSecret()
  if (!secret) throw new Error('Stripe webhook secret not configured (set splitpay_core.config.stripe_webhook_secret)')
  return stripe.webhooks.constructEvent(payload, signature, secret)
}

// Deduplicación por event.id (priority #2). Stripe puede entregar el mismo
// evento más de una vez; sin esto createAdditionalTransfers (entre otros) se
// ejecutaría dos veces. INSERT ... ON CONFLICT DO NOTHING da exactly-once: si
// la fila ya existía, rowCount === 0 y descartamos.
async function markEventProcessed(event) {
  const client = await pool.connect()
  try {
    const { rowCount } = await client.query(
      `INSERT INTO payments.processed_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type],
    )
    return rowCount > 0
  } finally {
    client.release()
  }
}

export async function handleWebhookEvent(event) {
  logger.info({ eventId: event.id, type: event.type }, 'Processing webhook event')

  const fresh = await markEventProcessed(event)
  if (!fresh) {
    logger.info({ eventId: event.id, type: event.type }, 'Duplicate webhook event — skipping')
    return
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object)
      break

    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object)
      break

    case 'payment_intent.canceled':
      await handlePaymentIntentCanceled(event.data.object)
      break

    case 'account.updated':
      await handleAccountUpdated(event.data.object)
      break

    case 'charge.dispute.created':
      await handleDisputeCreated(event.data.object)
      break

    case 'charge.dispute.closed':
      await handleDisputeClosed(event.data.object)
      break

    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object)
      break

    case 'invoice.paid':
      await handleInvoicePaid(event.data.object)
      break

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object)
      break

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionStateChange(event.type, event.data.object)
      break

    default:
      logger.debug({ type: event.type }, 'Unhandled webhook event type')
  }
}

async function handlePaymentIntentSucceeded(intent) {
  const client = await pool.connect()
  try {
    await paymentRepo.updatePaymentStatus(client, intent.id, 'succeeded')

    // Create additional transfers for multi-recipient splits
    const chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id

    if (chargeId) {
      await createAdditionalTransfers(intent.id, chargeId)
    }

    logger.info({ intentId: intent.id }, 'PaymentIntent succeeded — status updated')
  } finally {
    client.release()
  }
}

async function handlePaymentIntentFailed(intent) {
  const client = await pool.connect()
  try {
    await paymentRepo.updatePaymentStatus(client, intent.id, 'failed')
    logger.info({ intentId: intent.id }, 'PaymentIntent failed — status updated')
  } finally {
    client.release()
  }
}

async function handlePaymentIntentCanceled(intent) {
  const client = await pool.connect()
  try {
    await paymentRepo.updatePaymentStatus(client, intent.id, 'canceled')
    logger.info({ intentId: intent.id }, 'PaymentIntent canceled — status updated')
  } finally {
    client.release()
  }
}

async function handleAccountUpdated(account) {
  try {
    await syncAccountFromStripe(account.id)
  } catch (err) {
    logger.error({ err, accountId: account.id }, 'Failed to sync account from webhook')
  }
}

async function handleDisputeCreated(dispute) {
  const client = await pool.connect()
  try {
    // Resolve tenant scoping (priority #3) from the originating transaction.
    // The dispute carries the PaymentIntent id (`dispute.payment_intent`); from
    // it we look up the transaction to attach app_id/tenant_id/sub_tenant_id.
    // If the PI is unknown (e.g. a charge not created through this module) the
    // row is stored with NULL tenant and stays hidden under RLS.
    const paymentIntentId = typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null

    let txn = null
    if (paymentIntentId) {
      txn = await paymentRepo.findPaymentByStripeId(client, paymentIntentId)
    }

    await client.query(
      `INSERT INTO payments.disputes
         (stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, transaction_id,
          app_id, tenant_id, sub_tenant_id, amount, currency, reason, status, due_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12))
       ON CONFLICT (stripe_dispute_id) DO NOTHING`,
      [
        dispute.id,
        dispute.charge,
        paymentIntentId,
        txn?.id ?? null,
        txn?.metadata?.app_id ?? null,
        txn?.tenantId ?? null,
        txn?.subTenantId ?? null,
        dispute.amount,
        dispute.currency,
        dispute.reason,
        dispute.status,
        dispute.evidence_details?.due_by ?? null,
      ],
    )
    logger.warn(
      { disputeId: dispute.id, chargeId: dispute.charge, tenantId: txn?.tenantId ?? null },
      'Dispute created',
    )

    // Notify the origin app of the chargeback (priority #4 family).
    if (txn?.metadata?.app_id) {
      await emit(txn.metadata.app_id, 'splitpay.dispute.created', {
        disputeId:   dispute.id,
        paymentId:   txn.id,
        chargeId:    dispute.charge,
        amount:      dispute.amount,
        currency:    dispute.currency,
        reason:      dispute.reason,
        status:      dispute.status,
        tenantId:    txn.tenantId,
        subTenantId: txn.subTenantId,
      })
    }
  } finally {
    client.release()
  }
}

async function handleDisputeClosed(dispute) {
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE payments.disputes SET status = $1, updated_at = now()
       WHERE stripe_dispute_id = $2`,
      [dispute.status, dispute.id],
    )
    logger.info({ disputeId: dispute.id, status: dispute.status }, 'Dispute closed')
  } finally {
    client.release()
  }
}

// Publica un evento splitpay.* en `${appId}.events` para que la app de
// origen pueda reaccionar (e.g. aikikan-server marca fee_payments paid).
// El appId viene del metadata que la app inyectó al crear la sesión.
//
// Caso especial: cuando metadata.kind === 'platform_subscription' (cobros
// del tenant a la plataforma, no del cliente final a la app), publicamos
// también en `platform.events` para que tenant-config pueda actualizar el
// estado de la subscripción del tenant. Las apps NO necesitan ver estos
// eventos — son del plano plataforma↔tenant.
async function emit(appId, type, payload) {
  const isPlatformSubscription = payload?.metadata?.kind === 'platform_subscription'
  if (!appId && !isPlatformSubscription) {
    logger.warn({ type }, 'Skipping event emit — no app_id in checkout metadata')
    return
  }
  try {
    if (appId) await publish(redis, appId, { type, payload })
    if (isPlatformSubscription) await publish(redis, 'platform', { type, payload })
  } catch (err) {
    logger.error({ err, type, appId }, 'Failed to publish splitpay event')
  }
}

async function handleCheckoutSessionCompleted(session) {
  const client = await pool.connect()
  try {
    const updated = await checkoutRepo.markCompleted(client, session.id, {
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
      subscriptionId:  typeof session.subscription   === 'string' ? session.subscription   : session.subscription?.id   ?? null,
      customerId:      typeof session.customer       === 'string' ? session.customer       : session.customer?.id       ?? null,
      amount:          session.amount_total ?? null,
    })
    if (!updated) {
      logger.warn({ stripeSessionId: session.id }, 'checkout.session.completed for unknown session — ignoring')
      return
    }
    const meta = updated.metadata ?? {}
    const appId = meta.app_id || null
    await emit(appId, 'splitpay.checkout.completed', {
      sessionId:       updated.id,
      stripeSessionId: updated.stripe_session_id,
      mode:            updated.mode,
      paymentIntentId: updated.stripe_payment_intent_id,
      subscriptionId:  updated.stripe_subscription_id,
      customerId:      updated.stripe_customer_id,
      amount:          updated.amount,
      currency:        updated.currency,
      tenantId:        updated.tenant_id,
      subTenantId:     updated.sub_tenant_id,
      metadata:        meta,
    })
    logger.info({ sessionId: session.id, mode: updated.mode }, 'Checkout session completed — event emitted')
  } finally {
    client.release()
  }
}

async function handleInvoicePaid(invoice) {
  // Renovaciones recurrentes — Stripe genera invoice.paid en cada periodo.
  // Resolvemos el appId leyendo la sesión de checkout original si existe;
  // si no, intentamos el subscription metadata (que copiamos al crear).
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subscriptionId) {
    logger.debug({ invoiceId: invoice.id }, 'invoice.paid without subscription — ignoring')
    return
  }
  let appId  = invoice.metadata?.app_id || invoice.subscription_details?.metadata?.app_id || null
  let tenantId, subTenantId
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT * FROM splitpay_core.checkout_sessions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [subscriptionId],
    )
    if (rows[0]) {
      const sess = rows[0]
      const meta = sess.metadata ?? {}
      appId       = appId || meta.app_id || null
      tenantId    = sess.tenant_id
      subTenantId = sess.sub_tenant_id
    }
  } finally {
    client.release()
  }
  await emit(appId, 'splitpay.invoice.paid', {
    invoiceId:       invoice.id,
    subscriptionId,
    customerId:      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
    amount:          invoice.amount_paid,
    currency:        invoice.currency,
    periodStart:     invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    periodEnd:       invoice.period_end   ? new Date(invoice.period_end   * 1000).toISOString() : null,
    tenantId,
    subTenantId,
  })
  logger.info({ invoiceId: invoice.id, subscriptionId }, 'Invoice paid — event emitted')
}

async function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subscriptionId) return
  let appId  = invoice.metadata?.app_id || invoice.subscription_details?.metadata?.app_id || null
  let tenantId
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT app_id, tenant_id, metadata FROM splitpay_core.checkout_sessions
        WHERE stripe_subscription_id = $1 LIMIT 1`,
      [subscriptionId],
    )
    if (rows[0]) {
      appId    = appId || rows[0].metadata?.app_id || null
      tenantId = rows[0].tenant_id
    }
  } finally {
    client.release()
  }
  await emit(appId, 'splitpay.invoice.payment_failed', {
    invoiceId: invoice.id,
    subscriptionId,
    amount:    invoice.amount_due,
    currency:  invoice.currency,
    tenantId,
  })
}

async function handleSubscriptionStateChange(eventType, sub) {
  let appId = sub.metadata?.app_id || null
  let tenantId
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT app_id, tenant_id, metadata FROM splitpay_core.checkout_sessions
        WHERE stripe_subscription_id = $1 LIMIT 1`,
      [sub.id],
    )
    if (rows[0]) {
      appId    = appId || rows[0].metadata?.app_id || null
      tenantId = rows[0].tenant_id
    }
  } finally {
    client.release()
  }
  const type = eventType === 'customer.subscription.deleted'
    ? 'splitpay.subscription.deleted'
    : 'splitpay.subscription.updated'
  await emit(appId, type, {
    subscriptionId:    sub.id,
    status:            sub.status,
    currentPeriodEnd:  sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    tenantId,
  })
}
