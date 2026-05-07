// Subscriber Redis para los eventos splitpay.* relacionados con
// subscripciones del tenant a la plataforma (metadata.kind ===
// 'platform_subscription'). Splitpay los publica en el canal
// `platform.events` además del canal de la app correspondiente.
//
// Mantenemos sincronizadas las columnas `subscription_*` de
// `platform_tenants.tenants` con el estado real en Stripe.

import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool } from '../lib/db.js'

const CHANNEL = 'platform.events'

export function startSplitpaySubscriptionSubscriber() {
  const sub = new Redis(env.REDIS_URL, { lazyConnect: true })
  sub.connect().catch((err) => logger.error({ err }, 'Failed to connect splitpay subscriber'))
  sub.on('error', (err) => logger.error({ err }, 'splitpay subscriber error'))

  sub.subscribe(CHANNEL, (err) => {
    if (err) { logger.error({ err }, `Failed to subscribe to ${CHANNEL}`); return }
    logger.info(`tenant-config subscribed to ${CHANNEL} for platform_subscription events`)
  })

  sub.on('message', async (_channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    const meta = event?.payload?.metadata
    if (meta?.kind !== 'platform_subscription') return

    try {
      switch (event.type) {
        case 'splitpay.checkout.completed':
          await onCheckoutCompleted(event.payload)
          break
        case 'splitpay.invoice.paid':
          await onInvoicePaid(event.payload)
          break
        case 'splitpay.subscription.updated':
          await onSubscriptionUpdated(event.payload)
          break
        case 'splitpay.subscription.deleted':
          await onSubscriptionDeleted(event.payload)
          break
        case 'splitpay.invoice.payment_failed':
          await onInvoicePaymentFailed(event.payload)
          break
        default:
          logger.debug({ type: event.type }, 'Unhandled splitpay event for platform_subscription')
      }
    } catch (err) {
      logger.error({ err, type: event.type }, 'Failed to handle splitpay platform_subscription event')
    }
  })

  return sub
}

function plusPeriod(date, period) {
  const d = new Date(date)
  if (period === 'monthly') d.setMonth(d.getMonth() + 1)
  else if (period === 'annual') d.setFullYear(d.getFullYear() + 1)
  return d
}

async function onCheckoutCompleted(p) {
  if (p.mode !== 'subscription') return
  const tenantId = p.metadata?.tenant_id
  if (!tenantId) return logger.warn({ payload: p }, 'platform_subscription checkout without tenant_id')

  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT subscription_period FROM platform_tenants.tenants WHERE id = $1`,
      [tenantId],
    )
    const period = rows[0]?.subscription_period ?? 'monthly'
    const renewsAt = plusPeriod(new Date(), period)

    await client.query(
      `UPDATE platform_tenants.tenants SET
         subscription_status                 = 'active',
         subscription_stripe_subscription_id = $2,
         subscription_stripe_customer_id     = $3,
         subscription_started_at             = COALESCE(subscription_started_at, now()),
         subscription_renews_at              = $4
       WHERE id = $1`,
      [tenantId, p.subscriptionId ?? null, p.customerId ?? null, renewsAt],
    )
    logger.info({ tenantId, subscriptionId: p.subscriptionId }, 'Tenant subscription activated')
  } finally {
    client.release()
  }
}

async function onInvoicePaid(p) {
  if (!p.subscriptionId) return
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE platform_tenants.tenants SET
         subscription_status    = 'active',
         subscription_renews_at = COALESCE($2, subscription_renews_at)
       WHERE subscription_stripe_subscription_id = $1`,
      [p.subscriptionId, p.periodEnd ? new Date(p.periodEnd) : null],
    )
    logger.info({ subscriptionId: p.subscriptionId }, 'Tenant subscription renewed')
  } finally {
    client.release()
  }
}

async function onInvoicePaymentFailed(p) {
  if (!p.subscriptionId) return
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE platform_tenants.tenants SET subscription_status = 'past_due'
       WHERE subscription_stripe_subscription_id = $1`,
      [p.subscriptionId],
    )
  } finally { client.release() }
}

async function onSubscriptionUpdated(p) {
  if (!p.subscriptionId) return
  // Mapeo defensivo del status de Stripe a nuestros valores.
  const map = {
    active:           'active',
    trialing:         'trial',
    past_due:         'past_due',
    canceled:         'cancelled',
    unpaid:           'past_due',
    incomplete:       'inactive',
    incomplete_expired:'inactive',
  }
  const localStatus = map[p.status] ?? null
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE platform_tenants.tenants SET
         subscription_status                = COALESCE($2, subscription_status),
         subscription_cancel_at_period_end  = COALESCE($3, subscription_cancel_at_period_end),
         subscription_renews_at             = COALESCE($4, subscription_renews_at)
       WHERE subscription_stripe_subscription_id = $1`,
      [
        p.subscriptionId,
        localStatus,
        p.cancelAtPeriodEnd ?? null,
        p.currentPeriodEnd ? new Date(p.currentPeriodEnd) : null,
      ],
    )
  } finally { client.release() }
}

async function onSubscriptionDeleted(p) {
  if (!p.subscriptionId) return
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE platform_tenants.tenants SET subscription_status = 'cancelled'
       WHERE subscription_stripe_subscription_id = $1`,
      [p.subscriptionId],
    )
  } finally { client.release() }
}
