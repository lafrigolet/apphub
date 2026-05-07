import { pool, withTenant } from '../lib/db.js'
import { stripe } from '../lib/stripe.js'
import { redis } from '../lib/redis.js'
import { publish } from '@apphub/platform-sdk/redis'
import { logger } from '../lib/logger.js'
import { AppError } from '../utils/errors.js'
import * as splitRuleRepo from '../repositories/split-rule.repository.js'
import * as repo from '../repositories/checkout-session.repository.js'

// Crea una Stripe Checkout Session. Soporta:
//   - mode: 'payment'      → cobro one-shot
//   - mode: 'subscription' → recurring billing
//   - splitRuleId opcional:
//       * con regla → la primera destination recibe transfer_data; las
//                     demás se transfieren en el webhook (igual que en el
//                     flujo PaymentIntent existente).
//       * sin regla → "no-split": todo el importe va a la cuenta del
//                     platform Stripe; sin application_fee, sin transfers.
//
// El caller (p.ej. aikikan-server) pasa `metadata` libre — typicamente
// app_id, user_id, product_codes — que fluye a Stripe y vuelve en los
// eventos para que cada app ate su propio modelo (fee_payments,
// fee_subscriptions, …) al evento.
export async function createCheckoutSession(ctx, input) {
  const {
    mode,
    lineItems,
    successUrl,
    cancelUrl,
    customerEmail,
    splitRuleId = null,
    currency = 'eur',
    metadata  = {},
  } = input

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'lineItems requerido (al menos 1)', 422)
  }
  if (!['payment', 'subscription'].includes(mode)) {
    throw new AppError('VALIDATION_ERROR', "mode debe ser 'payment' o 'subscription'", 422)
  }

  return withTenant(ctx.tenantId, ctx.subTenantId, async (client) => {
    let primaryDestination = null
    if (splitRuleId) {
      const rule = await splitRuleRepo.findSplitRuleById(client, ctx, splitRuleId)
      if (!rule) throw new AppError('NOT_FOUND', 'Split rule no encontrada', 404)
      primaryDestination = rule.recipients?.[0]?.accountId ?? null
      if (!primaryDestination) {
        throw new AppError('VALIDATION_ERROR', 'Split rule sin destinations', 422)
      }
    }

    // El metadata se duplica en payment_intent_data / subscription_data
    // para que esté disponible tanto en checkout.session.completed como
    // en invoice.paid (renovaciones).
    const enrichedMetadata = {
      ...metadata,
      tenant_id:      ctx.tenantId,
      sub_tenant_id:  ctx.subTenantId ?? '',
      app_id:         ctx.appId ?? '',
      split_rule_id:  splitRuleId ?? '',
    }

    const sessionParams = {
      mode,
      line_items: lineItems,                        // [{ price: 'price_…', quantity: 1 }]
      success_url: successUrl,
      cancel_url:  cancelUrl,
      customer_email: customerEmail,
      metadata: enrichedMetadata,
    }

    if (mode === 'payment' && primaryDestination) {
      sessionParams.payment_intent_data = {
        transfer_data: { destination: primaryDestination },
        metadata: enrichedMetadata,
      }
    } else if (mode === 'payment') {
      sessionParams.payment_intent_data = { metadata: enrichedMetadata }
    } else if (mode === 'subscription' && primaryDestination) {
      sessionParams.subscription_data = {
        transfer_data: { destination: primaryDestination },
        metadata: enrichedMetadata,
      }
    } else {
      sessionParams.subscription_data = { metadata: enrichedMetadata }
    }

    let stripeSession
    try {
      stripeSession = await stripe.checkout.sessions.create(sessionParams)
    } catch (err) {
      logger.error({ err }, 'Stripe Checkout session creation failed')
      throw err  // splitpay error handler captura StripeError y devuelve 502
    }

    const row = await repo.insert(client, ctx, {
      mode,
      stripeSessionId: stripeSession.id,
      currency,
      splitRuleId,
      metadata: enrichedMetadata,
    })

    await publish(redis, 'platform', {
      type:    'splitpay.checkout.created',
      payload: {
        sessionId:   row.id,
        stripeSessionId: stripeSession.id,
        tenantId:    ctx.tenantId,
        appId:       ctx.appId,
        mode,
        metadata:    enrichedMetadata,
      },
    }).catch((err) => logger.warn({ err }, 'Failed to publish checkout.created event'))

    return {
      url:             stripeSession.url,
      sessionId:       row.id,
      stripeSessionId: stripeSession.id,
    }
  })
}

export async function getCheckoutSession(ctx, id) {
  return withTenant(ctx.tenantId, ctx.subTenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM splitpay_core.checkout_sessions WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    )
    return rows[0] ?? null
  })
}
