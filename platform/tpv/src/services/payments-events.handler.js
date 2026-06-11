import { logger } from '../lib/logger.js'
import { withStaffBypass } from '../lib/db.js'
import { publishEvent } from '../lib/redis.js'
import * as factsRepo from '../repositories/billing-facts.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import { issueReceiptCore, buildIssuedPayload } from './receipts.service.js'

const PATTERN = '*.events'

// Cobros sin pos cuyo recibo emite tpv: Tap to Pay (source 'tap_to_pay') y QR
// Checkout web (source 'tpv_checkout'). Ambos llegan como `payment.succeeded`
// de platform/payments (el webhook propaga `source`). Mismo patrón que
// pos-events.handler: crea un billing_fact (idempotente por bill_id = PI id) y,
// si el tenant tiene auto_issue_simplified, emite el ticket simplificado.
const TPV_SOURCES = new Set(['tap_to_pay', 'tpv_checkout'])

export function startPaymentsEventsHandler({ redis }) {
  const sub = redis.duplicate()
  sub.psubscribe(PATTERN, (err) => {
    if (err) {
      logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe')
      return
    }
    logger.info({ pattern: PATTERN }, 'tpv subscribed to payments events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (event?.type !== 'payment.succeeded') return
    if (!TPV_SOURCES.has(event.payload?.source)) return

    try {
      await onPaymentSucceeded(event)
    } catch (err) {
      logger.error({ err, channel }, 'tpv payments event handler failed')
    }
  })

  return sub
}

async function onPaymentSucceeded(event) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.providerTxId || !p.amountCents) return

  const issuedPayloads = await withStaffBypass(async (c) => {
    const out = []
    const settings = await settingsRepo.getOrDefaultsExplicit(c, p.appId, p.tenantId)

    // Importe IVA incluido a default_sale_tax_rate (no hay líneas con su tipo).
    const total = Number(p.amountCents)
    const rate = Number(settings.default_sale_tax_rate ?? 21)
    const base = Math.round(total / (1 + rate / 100))
    const tax = total - base
    const currency = (p.currency ?? 'eur').toUpperCase()
    const method = p.source === 'tpv_checkout' ? 'card_online' : 'card_present'

    const fact = await factsRepo.insertIfAbsent(c, {
      appId: p.appId,
      tenantId: p.tenantId,
      subTenantId: p.subTenantId ?? null,
      billId: p.providerTxId,           // PI id → idempotencia de reentrega
      deviceId: null,
      sessionId: null,                  // un cobro con tarjeta no va a caja de efectivo
      currency,
      subtotalCents: base,
      taxCents: tax,
      tipCents: 0,
      totalCents: total,
      payments: [{ method, amountCents: total, tipCents: 0, externalRef: p.providerTxId }],
      lines: [{ sku: null, name: 'Venta TPV', qty: 1, unitPriceCents: base, modifiers: null, course: null }],
      billMetadata: { source: p.source },
      attributed: false,
    })
    if (!fact) return out // ya procesado

    if (settings.auto_issue_simplified) {
      try {
        const scope = { appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null }
        const { receipt, lines } = await issueReceiptCore(c, scope, { fact, type: 'simplified' })
        out.push(buildIssuedPayload(receipt, lines))
      } catch (err) {
        logger.warn({ err: err.message, pi: p.providerTxId }, 'tpv auto-issue failed — fact left pending')
      }
    }
    return out
  })

  for (const payload of issuedPayloads ?? []) {
    await publishEvent('tpv.receipt.issued', payload)
  }
}
