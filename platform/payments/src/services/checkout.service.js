// Stripe Checkout Sessions (hosted) — usado por el target web del TPV:
// el teclado fija el importe y mostramos un QR de la URL de Checkout para que
// el CLIENTE pague en su propio móvil. Al completarse, el webhook
// `checkout.session.completed` emite payment.succeeded (source 'tpv_checkout')
// y platform/tpv emite el recibo (fase 2). No persistimos transacción propia:
// el registro es la sesión Stripe + el recibo tpv.
import { randomUUID } from 'node:crypto'
import { stripe, isStubbed } from '../lib/stripe.js'
import { AppError } from '@apphub/platform-sdk/errors'
import { logger } from '../lib/logger.js'

class StripeError extends AppError {
  constructor(message, details = undefined) {
    super('STRIPE_ERROR', message, 502, details)
    this.name = 'StripeError'
  }
}

export async function createCheckoutSession(ctx, input) {
  const currency = input.currency ?? 'eur'
  if (isStubbed()) {
    const id = `cs_stub_${randomUUID().replace(/-/g, '')}`
    return { id, url: `https://stub.local/checkout/${id}`, stub: true }
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency,
          product_data: { name: input.productName ?? 'Cobro TPV' },
          unit_amount: input.amountCents,
        },
        quantity: 1,
      }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // metadata en la SESIÓN (no en payment_intent_data) → solo
      // checkout.session.completed dispara el recibo, sin doble emisión.
      metadata: {
        app_id: ctx.appId,
        tenant_id: ctx.tenantId,
        sub_tenant_id: ctx.subTenantId ?? '',
        source: 'tpv_checkout',
      },
    })
    return { id: session.id, url: session.url, stub: false }
  } catch (err) {
    logger.error({ err }, 'Stripe Checkout Session creation failed')
    throw new StripeError('Failed to create checkout session', err.message)
  }
}

export async function getCheckoutSession(ctx, id) {
  if (isStubbed() || id.startsWith('cs_stub_')) {
    return { id, status: 'open', paymentStatus: 'unpaid', stub: true }
  }
  try {
    const s = await stripe.checkout.sessions.retrieve(id)
    return { id: s.id, status: s.status, paymentStatus: s.payment_status, stub: false }
  } catch (err) {
    logger.error({ err }, 'Stripe Checkout Session retrieve failed')
    throw new StripeError('Failed to retrieve checkout session', err.message)
  }
}
