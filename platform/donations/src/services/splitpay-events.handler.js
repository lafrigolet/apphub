// Subscriber a los eventos que publica platform/splitpay tras los
// webhooks de Stripe. Sólo procesa los eventos cuya
// `metadata.purpose === 'donation'` — el resto los ignora.
//
// Splitpay publica en el canal `${appId}.events`. Como `donations` es
// un módulo plataforma que sirve a CUALQUIER app, usamos psubscribe
// con patrón `*.events` y filtramos por purpose.
//
// Eventos manejados:
//   splitpay.checkout.completed   → primera donación pagada / primer cobro de la suscripción
//   splitpay.invoice.paid         → cobros recurrentes (renovaciones)
//   splitpay.invoice.payment_failed → recurrente fallido → status past_due
//   splitpay.subscription.updated → cambios de estado / cancel_at_period_end
//   splitpay.subscription.deleted → cancelación efectiva

import { logger }          from '../lib/logger.js'
import { withStaffBypass } from '../lib/db.js'
import { publish }         from '@apphub/platform-sdk/redis'
import * as donationsRepo  from '../repositories/donations.repository.js'
import * as subsRepo       from '../repositories/donation-subscriptions.repository.js'
import * as causesRepo     from '../repositories/causes.repository.js'

const PATTERN = '*.events'

export function startSplitpayEventsHandler({ redis }) {
  // psubscribe necesita una conexión Redis aparte porque pub/sub no
  // multiplexa con comandos regulares. Si el caller (server.js) nos
  // pasó el cliente compartido, lo duplicamos.
  const sub = redis.duplicate()
  sub.on('error', (err) => logger.error({ err }, 'Redis pattern subscriber error'))
  sub.psubscribe(PATTERN, (err) => {
    if (err) {
      logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe')
      return
    }
    logger.info({ pattern: PATTERN }, 'donations subscribed to splitpay events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (!event?.type?.startsWith('splitpay.')) return
    const meta = event.payload?.metadata ?? {}
    if (meta.purpose !== 'donation') return

    try {
      switch (event.type) {
        case 'splitpay.checkout.completed':  await onCheckoutCompleted(event, redis); break
        case 'splitpay.invoice.paid':         await onInvoicePaid(event, redis);        break
        case 'splitpay.invoice.payment_failed': await onInvoicePaymentFailed(event, redis); break
        case 'splitpay.subscription.updated': await onSubscriptionUpdated(event, redis); break
        case 'splitpay.subscription.deleted': await onSubscriptionDeleted(event, redis); break
        default: /* noop */
      }
    } catch (err) {
      logger.error({ err, type: event.type, channel }, 'donation event handler failed')
    }
  })

  return sub
}

// Helper: lookup donation por donation_id en metadata; fallback por session.
async function findDonation(client, payload) {
  const id = payload.metadata?.donation_id
  if (id) {
    const row = await donationsRepo.findById(client, id)
    if (row) return row
  }
  if (payload.stripeSessionId) {
    const row = await donationsRepo.findBySessionId(client, payload.stripeSessionId)
    if (row) return row
  }
  return null
}

// ── checkout.session.completed ────────────────────────────────────────
async function onCheckoutCompleted(event, redis) {
  const p = event.payload
  await withStaffBypass(async (c) => {
    const donation = await findDonation(c, p)
    if (!donation) {
      logger.warn({ donationId: p.metadata?.donation_id, sessionId: p.stripeSessionId },
                  'checkout.completed for unknown donation — ignoring')
      return
    }

    if (p.mode === 'subscription' && p.subscriptionId) {
      // Primer cobro de una suscripción mensual. Persistimos la
      // suscripción (estado inicial 'active'); las renovaciones llegan
      // luego como invoice.paid.
      const sub = await subsRepo.upsertByStripeId(c, {
        appId:                donation.app_id,
        tenantId:             donation.tenant_id,
        subTenantId:          donation.sub_tenant_id,
        causeId:              donation.cause_id,
        donorUserId:          donation.donor_user_id,
        donorEmail:           donation.donor_email,
        donorName:            donation.donor_name,
        donorNif:              donation.donor_nif,
        amountCents:          donation.amount_cents,
        currency:             donation.currency,
        status:               'active',
        stripeSubscriptionId: p.subscriptionId,
        stripeCustomerId:     p.customerId,
        currentPeriodEnd:     null,
        cancelAtPeriodEnd:    false,
      })
      await c.query(
        `UPDATE platform_donations.donations SET subscription_id = $2 WHERE id = $1`,
        [donation.id, sub.id],
      )
    }

    const paid = await donationsRepo.markPaid(c, donation.id, {
      paymentIntentId: p.paymentIntentId,
      paidAt:          new Date(),
    })

    if (paid && paid.cause_id) {
      await causesRepo.incrementRaised(c, paid.cause_id, paid.amount_cents)
    }

    if (paid) {
      await publish(redis, donation.app_id, {
        type: 'donation.completed',
        payload: {
          donationId:  paid.id,
          appId:       paid.app_id,
          tenantId:    paid.tenant_id,
          donorEmail:  paid.donor_email,
          donorName:   paid.donor_name,
          amountCents: paid.amount_cents,
          currency:    paid.currency,
          causeId:     paid.cause_id,
          kind:        paid.kind,
        },
      })
    }
  })
}

// ── invoice.paid (renovación recurrente) ──────────────────────────────
async function onInvoicePaid(event, redis) {
  const p = event.payload
  if (!p.subscriptionId) return
  await withStaffBypass(async (c) => {
    const sub = await subsRepo.findByStripeId(c, p.subscriptionId)
    if (!sub) {
      logger.warn({ subId: p.subscriptionId }, 'invoice.paid for unknown subscription — ignoring')
      return
    }
    // ¿Es el primer cobro? El donation original ya fue marcado paid en
    // checkout.completed. Stripe a veces dispara invoice.paid también
    // para la primera factura — si encontramos un donation existente
    // referenciando esta suscripción Y status=paid, es el primero y no
    // creamos otro row.
    const { rows: existing } = await c.query(
      `SELECT id FROM platform_donations.donations
        WHERE subscription_id = $1 AND status = 'paid'
        ORDER BY created_at DESC LIMIT 1`,
      [sub.id],
    )
    // Heurística: si el último paid es de hace < 5 min, consideramos
    // que es el de checkout.completed y no duplicamos.
    if (existing[0]) {
      const { rows: t } = await c.query(
        `SELECT EXTRACT(EPOCH FROM (now() - paid_at)) AS sec
           FROM platform_donations.donations WHERE id = $1`,
        [existing[0].id],
      )
      if (t[0] && t[0].sec < 300) return
    }
    // Renovación — INSERT nueva donation paid
    const newDonation = await donationsRepo.insert(c, {
      appId:           sub.app_id,
      tenantId:        sub.tenant_id,
      subTenantId:     sub.sub_tenant_id,
      causeId:         sub.cause_id,
      donorUserId:     sub.donor_user_id,
      donorEmail:      sub.donor_email,
      donorName:       sub.donor_name,
      donorNif:        sub.donor_nif,
      amountCents:     p.amount ?? sub.amount_cents,
      currency:        sub.currency,
      status:          'paid',
      kind:            'recurring_monthly',
      anonymous:       false,
      message:         null,
    })
    await c.query(
      `UPDATE platform_donations.donations
          SET subscription_id        = $2,
              stripe_payment_intent_id = $3,
              paid_at                = now()
        WHERE id = $1`,
      [newDonation.id, sub.id, p.paymentIntentId ?? null],
    )
    if (sub.cause_id) await causesRepo.incrementRaised(c, sub.cause_id, newDonation.amount_cents)

    await publish(redis, sub.app_id, {
      type: 'donation.recurring.charged',
      payload: {
        donationId:     newDonation.id,
        subscriptionId: sub.id,
        appId:          sub.app_id,
        tenantId:       sub.tenant_id,
        donorEmail:     sub.donor_email,
        donorName:      sub.donor_name,
        amountCents:    newDonation.amount_cents,
        currency:       sub.currency,
        causeId:        sub.cause_id,
      },
    })
  })
}

// ── invoice.payment_failed (recurrente fallido) ───────────────────────
async function onInvoicePaymentFailed(event, redis) {
  const p = event.payload
  if (!p.subscriptionId) return
  await withStaffBypass(async (c) => {
    const sub = await subsRepo.findByStripeId(c, p.subscriptionId)
    if (!sub) return
    await c.query(
      `UPDATE platform_donations.donation_subscriptions
          SET status = 'past_due', updated_at = now()
        WHERE id = $1`,
      [sub.id],
    )
    await publish(redis, sub.app_id, {
      type: 'donation.recurring.failed',
      payload: {
        subscriptionId: sub.id,
        appId:          sub.app_id,
        tenantId:       sub.tenant_id,
        donorEmail:     sub.donor_email,
        donorName:      sub.donor_name,
      },
    })
  })
}

// ── subscription.updated (lifecycle / cancel_at_period_end) ───────────
async function onSubscriptionUpdated(event, _redis) {
  const p = event.payload
  if (!p.subscriptionId) return
  await withStaffBypass(async (c) => {
    const sub = await subsRepo.findByStripeId(c, p.subscriptionId)
    if (!sub) return
    await c.query(
      `UPDATE platform_donations.donation_subscriptions
          SET status               = COALESCE($2, status),
              current_period_end   = COALESCE($3, current_period_end),
              cancel_at_period_end = COALESCE($4, cancel_at_period_end),
              updated_at           = now()
        WHERE id = $1`,
      [sub.id, p.status ?? null, p.currentPeriodEnd ?? null, p.cancelAtPeriodEnd ?? null],
    )
  })
}

// ── subscription.deleted (cancelación efectiva) ───────────────────────
async function onSubscriptionDeleted(event, redis) {
  const p = event.payload
  if (!p.subscriptionId) return
  await withStaffBypass(async (c) => {
    const sub = await subsRepo.findByStripeId(c, p.subscriptionId)
    if (!sub) return
    await subsRepo.markCancelled(c, sub.id)
    await publish(redis, sub.app_id, {
      type: 'donation.recurring.cancelled',
      payload: {
        subscriptionId: sub.id,
        appId:          sub.app_id,
        tenantId:       sub.tenant_id,
        donorEmail:     sub.donor_email,
        donorName:      sub.donor_name,
      },
    })
  })
}
