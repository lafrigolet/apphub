// Stripe Terminal — Tap to Pay (card-present) support.
//
// The phone IS the reader: the native Stripe Terminal SDK (in the Expo app)
// asks our backend for a ConnectionToken, then we create a card_present
// PaymentIntent it collects against. Capture/confirm happen on the device;
// the existing webhook (routes/webhook.routes.js) reconciles the transaction
// to `succeeded`. See ADR-less plan + docs/use-cases/tpv.md.
import { randomUUID } from 'node:crypto'
import { pool, withTenantTransaction } from '../lib/db.js'
import { stripe, isStubbed } from '../lib/stripe.js'
import { publish, checkIdempotency, storeIdempotency } from '../lib/redis.js'
import * as txRepo from '../repositories/transaction.repository.js'
import * as configRepo from '../repositories/config.repository.js'
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

// ── Terminal Location ────────────────────────────────────────────────────────
// Tap to Pay requires a registered Location. We create one lazily and cache its
// id in platform_payments.config (key 'terminal_location_id') so we don't spawn
// a new Location on every connection-token request. Platform-wide (not per
// tenant) — matches how Stripe credentials are platform-level here.
export async function ensureLocation() {
  if (isStubbed()) return 'tml_stub'
  const client = await pool.connect()
  try {
    const existing = await configRepo.getValue(client, 'terminal_location_id')
    if (existing) return existing
    let location
    try {
      location = await stripe.terminal.locations.create({
        display_name: 'AppHub TPV',
        address: { country: 'ES', line1: 'Calle Mayor 1', city: 'Madrid', state: 'Madrid', postal_code: '28013' },
      })
    } catch (err) {
      logger.error({ err }, 'Stripe Terminal Location creation failed')
      throw new StripeError('Failed to create Terminal location', err.message)
    }
    await configRepo.upsertValue(client, 'terminal_location_id', location.id, null)
    logger.info({ locationId: location.id }, 'Terminal Location created')
    return location.id
  } finally {
    client.release()
  }
}

// ── Connection token ─────────────────────────────────────────────────────────
// The native SDK's tokenProvider calls this on init/refresh. We also hand back
// the Location id so the app can discover the Tap to Pay (or simulated) reader.
export async function createConnectionToken(ctx) {
  const locationId = await ensureLocation()
  if (isStubbed()) {
    return { secret: `pst_stub_${randomUUID().replace(/-/g, '')}`, locationId, stub: true }
  }
  try {
    const token = await stripe.terminal.connectionTokens.create()
    await emit(ctx, 'terminal.connection_token.issued', {})
    return { secret: token.secret, locationId, stub: false }
  } catch (err) {
    logger.error({ err }, 'Stripe Terminal ConnectionToken failed')
    throw new StripeError('Failed to create connection token', err.message)
  }
}

// ── card_present PaymentIntent ───────────────────────────────────────────────
// Mirror of payment.service.createPaymentIntent but for in-person Terminal:
// `payment_method_types: ['card_present']` is the ONE place Stripe allows this
// parameter (Terminal cannot use dynamic payment methods).
export async function createTerminalPaymentIntent(ctx, input) {
  const idemKey = input.idempotencyKey ?? randomUUID()
  const scope = `${ctx.appId}:${ctx.tenantId}:${idemKey}`
  const cached = await checkIdempotency(scope)
  if (cached) return JSON.parse(cached)

  const currency = input.currency ?? 'eur'
  const stub = isStubbed()

  let providerTxId, clientSecret, status
  if (stub) {
    providerTxId = `pi_stub_${randomUUID().replace(/-/g, '')}`
    clientSecret = `${providerTxId}_secret_stub`
    status = 'requires_payment_method'
  } else {
    let intent
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency,
          payment_method_types: ['card_present'],
          capture_method: 'automatic',
          metadata: {
            app_id: ctx.appId,
            tenant_id: ctx.tenantId,
            sub_tenant_id: ctx.subTenantId ?? '',
            user_id: ctx.userId ?? '',
            source: 'tap_to_pay',
            ...input.metadata,
          },
        },
        { idempotencyKey: `tpi_${scope}` },
      )
    } catch (err) {
      logger.error({ err }, 'Stripe Terminal PaymentIntent creation failed')
      throw new StripeError('Failed to create terminal payment intent', err.message)
    }
    providerTxId = intent.id
    clientSecret = intent.client_secret
    status = intent.status ?? 'requires_payment_method'
  }

  const tx = await tenantTx(ctx, (client) => txRepo.insertTransaction(client, ctx, {
    userId: ctx.userId ?? null,
    provider: 'stripe',
    providerTxId,
    amountCents: input.amountCents,
    currency,
    status,
    idempotencyKey: idemKey,
    metadata: { source: 'tap_to_pay', ...(input.metadata ?? {}) },
  }))

  const result = { transactionId: tx.id, paymentIntentId: providerTxId, clientSecret, status, stub }
  await storeIdempotency(scope, result)
  await emit(ctx, 'payment.intent.created', {
    transactionId: tx.id, providerTxId, amountCents: input.amountCents, currency, status, source: 'tap_to_pay',
  })
  return result
}
