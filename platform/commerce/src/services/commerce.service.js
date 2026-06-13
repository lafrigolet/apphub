import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/commerce.repository.js'

export class CommerceError extends Error {
  constructor(code, message, statusCode = 422) {
    super(message); this.code = code; this.statusCode = statusCode; this.name = 'CommerceError'
  }
}

const tx = (scope, fn) =>
  withTenantTransaction(scope.appId, scope.tenantId, scope.subTenantId ?? null, fn)

const toView = (r) => r && ({
  id: r.id, kind: r.kind, refId: r.ref_id, clientUserId: r.client_user_id,
  amountCents: r.amount_cents, currency: r.currency, status: r.status,
  providerTxId: r.provider_tx_id, fulfillment: r.fulfillment, createdAt: r.created_at,
})

// Crea la intención de compra (pendiente). El portal después crea la sesión de
// pago en platform/payments y enlaza su transactionId con enlazarTx().
export async function crearCheckout(scope, input) {
  if (!['package', 'booking'].includes(input.kind)) throw new CommerceError('KIND_INVALIDO', 'kind debe ser package|booking')
  if (!input.refId) throw new CommerceError('REF_REQUERIDA', 'refId requerido')
  if (!(input.amountCents > 0)) throw new CommerceError('IMPORTE_INVALIDO', 'amountCents debe ser > 0')
  return tx(scope, async (c) => toView(await repo.insertCheckout(c, { ...scope, ...input })))
}

export function enlazarTx(scope, id, providerTxId) {
  return tx(scope, async (c) => {
    const row = await repo.linkTx(c, id, providerTxId)
    if (!row) throw new CommerceError('CHECKOUT_NO_ENLAZABLE', 'checkout inexistente o no pendiente')
    return toView(row)
  })
}

export function getCheckout(scope, id) {
  return tx(scope, async (c) => {
    const row = await repo.getById(c, id)
    if (!row) throw new CommerceError('CHECKOUT_NO_ENCONTRADO', 'checkout no encontrado', 404)
    return toView(row)
  })
}

// Consumidor de eventos de platform/payments. Casa el pago con el checkout por
// el transactionId (que el portal enlazó) y dispara el fulfillment por evento.
export async function handlePaymentEvent(event) {
  const p = event.payload ?? {}
  const txId = p.transactionId
  if (!p.appId || !p.tenantId || !txId) return
  const scope = { appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null }

  await tx(scope, async (c) => {
    const co = await repo.findByTx(c, txId)
    if (!co || co.status !== 'pending') return // no es nuestro, o ya procesado (idempotente)

    if (event.type === 'payment.failed') {
      await repo.markStatus(c, co.id, 'failed')
      return
    }
    if (event.type !== 'payment.succeeded') return

    await repo.markStatus(c, co.id, 'paid')
    // Fulfillment dirigido por evento: el módulo dueño (packages/bookings) lo
    // consume y escribe SU esquema. No cruzamos esquemas desde aquí.
    await publish({
      type: 'commerce.purchase.paid',
      payload: {
        appId: co.app_id, tenantId: co.tenant_id, subTenantId: co.sub_tenant_id ?? null,
        checkoutId: co.id, kind: co.kind, refId: co.ref_id,
        clientUserId: co.client_user_id, amountCents: co.amount_cents, currency: co.currency,
      },
    })
    logger.info({ checkoutId: co.id, kind: co.kind }, 'commerce: checkout pagado → fulfillment emitido')
  })
}
