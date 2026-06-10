// Stripe Checkout Sessions — "cobrar desde el móvil" vía QR / payment link.
//
// El cajero genera un cobro y muestra el QR (`url`) o lo comparte; el CLIENTE
// paga en SU propio dispositivo (tarjeta, wallets y, en ES, Bizum si está
// habilitado en la cuenta). No es card-present: no hay lectura de tarjeta en el
// móvil del cajero, así que no entra en CPoC/MPoC ni necesita hardware.
//
// La transacción se persiste keyed por el id de sesión (`cs_...`) y se reconcilia
// con los eventos checkout.session.* en webhook.service.js (no con
// payment_intent.succeeded, porque al crear la sesión aún no existe el PI).
import { randomUUID } from 'node:crypto'
import { pool, withTenantTransaction } from '../lib/db.js'
import { stripe, isStubbed } from '../lib/stripe.js'
import { checkIdempotency, storeIdempotency, publish } from '../lib/redis.js'
import * as txRepo from '../repositories/transaction.repository.js'
import { AppError } from '@apphub/platform-sdk/errors'
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

// Base para los success/cancel por defecto (el cajero puede sobreescribir por request).
function returnBase() {
  return process.env.PAYMENTS_CHECKOUT_RETURN_BASE_URL
    ?? process.env.PLATFORM_PUBLIC_BASE_URL
    ?? 'https://hulkstein.com'
}

// QR opcional: `qrcode` se carga de forma perezosa. Si no está instalado (imagen
// sin rebuild todavía) devolvemos `qr: null` y el cliente puede renderizar el QR
// a partir de `url`. Tras instalar la dep, `qr` es un data-URL PNG listo para <img>.
let _qrLib // undefined = sin intentar; null = no disponible
async function maybeQr(text) {
  if (_qrLib === undefined) {
    try { _qrLib = (await import('qrcode')).default }
    catch { _qrLib = null; logger.warn('qrcode no instalado — checkout devuelve solo `url` (sin data-URL QR)') }
  }
  if (!_qrLib) return null
  try { return await _qrLib.toDataURL(text, { margin: 1, width: 320 }) }
  catch (err) { logger.warn({ err }, 'QR generation failed'); return null }
}

export async function createCheckoutSession(ctx, input) {
  const idemKey = input.idempotencyKey ?? randomUUID()
  const scope = `${ctx.appId}:${ctx.tenantId}:${idemKey}`
  const cached = await checkIdempotency(scope)
  if (cached) return JSON.parse(cached)

  const currency = input.currency ?? 'eur'
  const stub = isStubbed()
  const metadata = {
    app_id: ctx.appId,
    tenant_id: ctx.tenantId,
    sub_tenant_id: ctx.subTenantId ?? '',
    user_id: ctx.userId ?? '',
    source: 'checkout_link',
    ...input.metadata,
  }

  let sessionId, url, status
  if (stub) {
    // Dev-stub: sin claves Stripe. Sesión y URL falsas para flujo e2e local.
    sessionId = `cs_stub_${randomUUID().replace(/-/g, '')}`
    url = `https://checkout.stripe.com/c/pay/stub#${sessionId}`
    status = 'pending'
  } else {
    const expiresAt = Math.floor(Date.now() / 1000) + (input.expiresInMinutes ?? 30) * 60
    let session
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [{
            quantity: 1,
            price_data: {
              currency,
              unit_amount: input.amountCents,
              product_data: { name: input.description ?? 'Pago' },
            },
          }],
          success_url: input.successUrl ?? `${returnBase()}/pay/ok`,
          cancel_url: input.cancelUrl ?? `${returnBase()}/pay/cancel`,
          // Sin payment_method_types → Checkout ofrece los métodos habilitados en
          // la cuenta (tarjeta, Apple/Google Pay y, en ES, Bizum).
          ...(input.paymentMethodTypes ? { payment_method_types: input.paymentMethodTypes } : {}),
          expires_at: expiresAt,
          metadata,
          // Estampamos también en el PaymentIntent que generará la sesión, por si
          // algún consumidor reconcilia por PI más adelante.
          payment_intent_data: { metadata },
        },
        { idempotencyKey: `cs_${scope}` },
      )
    } catch (err) {
      logger.error({ err }, 'Stripe Checkout Session creation failed')
      throw new StripeError('Failed to create checkout session', err.message)
    }
    sessionId = session.id
    url = session.url
    status = 'pending'
  }

  const tx = await tenantTx(ctx, (client) => txRepo.insertTransaction(client, ctx, {
    userId: ctx.userId ?? null,
    provider: 'stripe',
    providerTxId: sessionId,
    amountCents: input.amountCents,
    currency,
    status,
    idempotencyKey: idemKey,
    metadata: { source: 'checkout_link', ...input.metadata },
  }))

  const qr = await maybeQr(url)
  const result = { transactionId: tx.id, sessionId, url, qr, status, stub }
  await storeIdempotency(scope, result)
  await emit(ctx, 'payment.checkout.created', {
    transactionId: tx.id, sessionId, amountCents: input.amountCents, currency, status, source: 'checkout_link',
  })
  return result
}

export { StripeError }
