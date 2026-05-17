import { ForbiddenError, NotFoundError, ValidationError, AppError } from '@apphub/platform-sdk/errors'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/fees.repository.js'
import { logger } from '../lib/logger.js'
import { env } from '../lib/env.js'

// El servicio ya no habla directamente con Stripe — delega en el módulo
// `splitpay` (platform-core). Los webhooks de Stripe los procesa splitpay
// y emite eventos en `platform.events`; aikikan-server los consume en
// events/splitpay.handler.js para actualizar fee_payments y
// fee_subscriptions.

const ADMIN_ROLES = new Set(['owner', 'admin'])

// ── Listado de productos disponibles (público) ─────────────────────────
export async function listProducts(tenantId) {
  if (!tenantId) throw new ValidationError('tenantId requerido')
  return withTenantTransaction(
    pool, 'aikikan', tenantId, null,
    (client) => repo.listProducts(client),
  )
}

// ── Estado del socio + historial de pagos ─────────────────────────────
export async function getMyFees(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const products      = await repo.listProducts(client)
      const payments      = await repo.listPaymentsForUser(client, identity.userId)
      const subscription  = await repo.findSubscriptionForUser(client, identity.userId)

      const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      const status = {}
      for (const p of products) {
        const lastPaid = payments.find((pay) =>
          pay.status === 'paid' &&
          pay.product_codes.includes(p.code) &&
          new Date(pay.paid_at) > oneYearAgo,
        )
        status[p.code] = lastPaid
          ? { paid: true, paidAt: lastPaid.paid_at, paymentId: lastPaid.id }
          : { paid: false }
      }

      return { products, payments, subscription, status }
    },
  )
}

// ── Crear sesión de checkout ──────────────────────────────────────────
//
// El socio elige uno o más productos. Si todos son one_shot → mode 'payment';
// si hay un recurring_annual → mode 'subscription'. La sesión la crea
// platform-core/splitpay; aikikan-server solo pre-registra el pago como
// pending y guarda el sessionId para correlacionar con el webhook.
export async function createCheckout(identity, bearerToken, { codes, returnPath = '/area-socio' }) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new ValidationError('codes requerido — al menos un product code')
  }

  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const products = await repo.findProductsByCodes(client, codes)
      if (products.length !== codes.length) {
        throw new NotFoundError('Algún producto no existe en el catálogo')
      }
      for (const p of products) {
        if (!p.stripe_price_id) {
          throw new AppError('STRIPE_PRICE_MISSING',
            `El producto "${p.code}" no tiene stripe_price_id configurado. Crea el Price en Stripe (vía console / splitpay) y guarda su ID en BD.`,
            503)
        }
      }

      const hasRecurring = products.some((p) => p.kind === 'recurring_annual')
      const mode = hasRecurring ? 'subscription' : 'payment'
      const totalCents = products.reduce((s, p) => s + p.amount_cents, 0)
      const currency   = products[0].currency

      const baseUrl = env.AIKIKAN_PUBLIC_URL ?? 'http://aikikan.hulkstein.local:8080'
      const payload = {
        mode,
        currency,
        customerEmail: identity.email,
        lineItems: products.map((p) => ({ price: p.stripe_price_id, quantity: 1 })),
        successUrl: `${baseUrl}${returnPath}?fees_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${baseUrl}${returnPath}?fees_status=cancel`,
        // splitRuleId: ausente → no-split. En el futuro, si la cuota de
        // matrícula se reparte entre la federación y el dojo, se pasará
        // aquí el id de la regla configurada en splitpay.
        metadata: {
          user_id:       identity.userId,
          product_codes: products.map((p) => p.code).join(','),
          // app_id, tenant_id, sub_tenant_id los inyecta splitpay desde
          // el ctx — no hace falta duplicarlos aquí.
        },
      }

      const splitpayUrl = `${env.SPLITPAY_BASE_URL}/v1/splitpay/checkout-sessions`
      let res
      try {
        res = await fetch(splitpayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${bearerToken}`,
          },
          body: JSON.stringify(payload),
        })
      } catch (err) {
        logger.error({ err, splitpayUrl }, 'Failed to reach splitpay')
        throw new AppError('SPLITPAY_UNREACHABLE', 'No se pudo contactar el servicio de pagos', 502)
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        logger.warn({ status: res.status, json }, 'splitpay rejected checkout creation')
        throw new AppError(
          json?.error?.code ?? 'SPLITPAY_ERROR',
          json?.error?.message ?? 'Error creando la sesión de pago',
          res.status,
        )
      }
      const { url, stripeSessionId } = json.data ?? {}
      if (!url || !stripeSessionId) {
        throw new AppError('SPLITPAY_INVALID_RESPONSE', 'Respuesta inesperada de splitpay', 502)
      }

      // Pre-registramos el pago como pending. El handler de eventos lo
      // marcará paid al recibir splitpay.checkout.completed.
      await repo.insertPayment(client, {
        appId:           identity.appId,
        tenantId:        identity.tenantId,
        subTenantId:     identity.subTenantId ?? null,
        userId:          identity.userId,
        productCodes:    products.map((p) => p.code),
        amountCents:     totalCents,
        currency,
        stripeSessionId,
      })

      return { url, sessionId: stripeSessionId }
    },
  )
}

// ── Admin: actualiza stripe_price_id de un producto ───────────────────
export async function setProductStripePriceId(identity, code, stripePriceId) {
  if (!ADMIN_ROLES.has(identity?.role)) throw new ForbiddenError('Only owner/admin')
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const { rows } = await client.query(
        `UPDATE app_aikikan.fee_products SET stripe_price_id = $2, updated_at = now() WHERE code = $1 RETURNING *`,
        [code, stripePriceId],
      )
      if (rows.length === 0) throw new NotFoundError('Product')
      return rows[0]
    },
  )
}
