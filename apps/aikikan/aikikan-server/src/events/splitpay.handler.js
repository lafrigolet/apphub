// Subscriber for splitpay events emitted from platform-core when Stripe
// fires checkout.session.completed / invoice.paid / customer.subscription.*.
// Channel = `${appId}.events` per platform-sdk's publish(); our app_id is
// 'aikikan', so we listen on 'aikikan.events'.
//
// Each event carries enough metadata (sessionId, subscriptionId, tenantId,
// metadata.user_id, metadata.product_codes) to update fee_payments and
// fee_subscriptions atomically.
import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/fees.repository.js'

const CHANNEL = `${'aikikan'}.events`

export function startSplitpayEventSubscriber() {
  const sub = new Redis(env.REDIS_URL, { lazyConnect: true })

  sub.connect().catch((err) => logger.error({ err }, 'Failed to connect splitpay subscriber'))
  sub.on('error', (err) => logger.error({ err }, 'splitpay subscriber error'))

  sub.subscribe(CHANNEL, (err) => {
    if (err) { logger.error({ err }, `Failed to subscribe to ${CHANNEL}`); return }
    logger.info(`aikikan-server subscribed to ${CHANNEL}`)
  })

  sub.on('message', async (_channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (!event?.type?.startsWith('splitpay.')) return

    try {
      switch (event.type) {
        case 'splitpay.checkout.completed':
          await onCheckoutCompleted(event.payload)
          break
        case 'splitpay.invoice.paid':
          await onInvoicePaid(event.payload)
          break
        case 'splitpay.subscription.updated':
        case 'splitpay.subscription.deleted':
          await onSubscriptionStateChange(event.payload)
          break
        case 'splitpay.invoice.payment_failed':
          logger.warn({ subscriptionId: event.payload?.subscriptionId }, 'Subscription payment failed')
          break
        default:
          logger.debug({ type: event.type }, 'Unhandled splitpay event')
      }
    } catch (err) {
      logger.error({ err, type: event.type }, 'Failed to handle splitpay event')
    }
  })

  return sub
}

async function onCheckoutCompleted(p) {
  if (!p?.tenantId || !p?.metadata?.user_id || !p?.stripeSessionId) {
    logger.warn({ payload: p }, 'splitpay.checkout.completed payload incomplete')
    return
  }
  await withTenantTransaction(
    pool, 'aikikan', p.tenantId, p.subTenantId ?? null,
    async (client) => {
      const payment = await repo.markPaymentPaid(
        client,
        p.stripeSessionId,
        p.paymentIntentId ?? null,
        null, // invoiceId — splitpay envía el invoice en el evento de invoice.paid
      )
      if (payment) {
        logger.info({ paymentId: payment.id }, 'fee_payments → paid')
      }

      // Si fue subscription, persistimos el estado inicial. Nos basta lo
      // que ya viene en el evento — no hace falta llamar de vuelta a
      // splitpay para retrieve.
      if (p.mode === 'subscription' && p.subscriptionId) {
        await repo.upsertSubscription(client, {
          appId:                'aikikan',
          tenantId:             p.tenantId,
          subTenantId:          p.subTenantId ?? null,
          userId:               p.metadata.user_id,
          status:               'active',
          stripeSubscriptionId: p.subscriptionId,
          stripeCustomerId:     p.customerId ?? null,
          currentPeriodEnd:     null,
          cancelAtPeriodEnd:    false,
        })
      }
    },
  )
}

async function onInvoicePaid(p) {
  if (!p?.subscriptionId || !p?.tenantId) return

  await withTenantTransaction(
    pool, 'aikikan', p.tenantId, p.subTenantId ?? null,
    async (client) => {
      const existing = await repo.findSubscriptionByStripeId(client, p.subscriptionId)
      if (!existing) {
        logger.debug({ subscriptionId: p.subscriptionId }, 'invoice.paid for unknown subscription — ignoring')
        return
      }
      // Renovación — registramos un payment row paid + actualizamos periodo.
      await repo.insertSubscriptionPayment(client, {
        appId:           existing.app_id,
        tenantId:        existing.tenant_id,
        subTenantId:     existing.sub_tenant_id ?? null,
        userId:          existing.user_id,
        productCodes:    ['anual'],
        amountCents:     p.amount,
        currency:        p.currency,
        stripeInvoiceId: p.invoiceId,
      })
      await repo.upsertSubscription(client, {
        appId:                existing.app_id,
        tenantId:             existing.tenant_id,
        subTenantId:          existing.sub_tenant_id ?? null,
        userId:               existing.user_id,
        status:               'active',
        stripeSubscriptionId: p.subscriptionId,
        stripeCustomerId:     existing.stripe_customer_id,
        currentPeriodEnd:     p.periodEnd ? new Date(p.periodEnd) : null,
        cancelAtPeriodEnd:    existing.cancel_at_period_end,
      })
    },
  )
}

async function onSubscriptionStateChange(p) {
  if (!p?.subscriptionId || !p?.tenantId) return

  await withTenantTransaction(
    pool, 'aikikan', p.tenantId, null,
    async (client) => {
      const existing = await repo.findSubscriptionByStripeId(client, p.subscriptionId)
      if (!existing) return
      await repo.upsertSubscription(client, {
        appId:                existing.app_id,
        tenantId:             existing.tenant_id,
        subTenantId:          existing.sub_tenant_id ?? null,
        userId:               existing.user_id,
        status:               p.status,
        stripeSubscriptionId: p.subscriptionId,
        stripeCustomerId:     existing.stripe_customer_id,
        currentPeriodEnd:     p.currentPeriodEnd ? new Date(p.currentPeriodEnd) : existing.current_period_end,
        cancelAtPeriodEnd:    p.cancelAtPeriodEnd ?? false,
      })
    },
  )
}
