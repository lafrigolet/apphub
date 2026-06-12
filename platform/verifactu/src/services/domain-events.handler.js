import { publish } from '@apphub/platform-sdk/redis'
import { logger } from '../lib/logger.js'
import { generarQrDataUri } from '../lib/qr.js'
import { crearRegistro } from './verifactu.service.js'

const PATTERN = '*.events'

// Integración por eventos (uso §15): genera el registro Veri*Factu de alta a
// partir de eventos de dominio de otros módulos platform.
//
//   order.completed   (platform/orders)    → registro de alta (F1)
//   donation.created  (platform/donations) → registro de alta (F1)
//
// NO se consume `pos.bill.closed`: los tiques de POS ya generan registro vía la
// cadena pos.bill.* → platform/tpv → tpv.receipt.issued (que consume
// tpv-events.handler). Consumirlo aquí duplicaría la emisión. La cobertura POS
// es, por tanto, transitiva (ADR 015).
//
// Dedupe: el alta lleva order_id/donation_id (índices únicos parciales en
// registros). Si el evento se reentrega, el segundo INSERT choca con el índice
// (23505) y se ignora — idempotente.
export function startDomainEventsHandler({ redis }) {
  const sub = redis.duplicate()
  sub.psubscribe(PATTERN, (err) => {
    if (err) { logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe'); return }
    logger.info({ pattern: PATTERN }, 'verifactu subscribed to domain events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    const handler = HANDLERS[event?.type]
    if (!handler) return
    try {
      await handler(event, redis)
    } catch (err) {
      if (esConflictoDedupe(err)) {
        logger.info({ type: event.type, channel }, 'verifactu: registro ya existía (dedupe) — ignorado')
        return
      }
      logger.error({ err, type: event.type, channel }, 'verifactu domain event handler failed')
    }
  })

  return sub
}

// Conflicto con un índice único de dedupe (order_id/donation_id/bill_id).
function esConflictoDedupe(err) {
  return err?.code === '23505' && /uq_vf_registros_/.test(err?.constraint ?? err?.message ?? '')
}

const toEuros = (cents) => (cents == null ? null : (Number(cents) / 100).toFixed(2))
const toIsoDate = (ts) => (ts ? String(ts).slice(0, 10) : undefined)
const scopeDe = (p) => ({ appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null })

async function onOrderCompleted(event, redis) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.orderId) return
  const res = await crearRegistro(scopeDe(p), {
    tipo: 'alta',
    tipoFactura: 'F1',
    origen: 'orders',
    orderId: p.orderId,
    clienteNombre: p.buyerName ?? p.buyer?.name ?? null,
    clienteNif: p.buyerNif ?? p.buyer?.nif ?? null,
    fechaExpedicion: toIsoDate(p.completedAt ?? p.createdAt),
    importeTotal: toEuros(p.totalCents ?? p.amountCents),
    cuotaTotal: toEuros(p.taxCents),
    totalDisplay: p.totalCents != null ? `${toEuros(p.totalCents)} €` : null,
  })
  await publishCreated(redis, p, res, { orderId: p.orderId })
}

async function onDonationCreated(event, redis) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.donationId) return
  const res = await crearRegistro(scopeDe(p), {
    tipo: 'alta',
    tipoFactura: 'F1',
    origen: 'donations',
    donationId: p.donationId,
    clienteNombre: p.donorName ?? p.donor?.name ?? null,
    clienteNif: p.donorNif ?? p.donor?.nif ?? null,
    fechaExpedicion: toIsoDate(p.createdAt),
    importeTotal: toEuros(p.amountCents),
    cuotaTotal: toEuros(p.taxCents ?? 0),
    totalDisplay: p.amountCents != null ? `${toEuros(p.amountCents)} €` : null,
  })
  await publishCreated(redis, p, res, { donationId: p.donationId })
}

async function publishCreated(redis, p, res, refs) {
  const qrDataUri = res.qrUrl ? await generarQrDataUri(res.qrUrl) : null
  await publish(redis, 'platform', {
    type: 'verifactu.registro.created',
    payload: {
      appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null,
      ...refs, numSerie: res.serie, huella: res.huella, qrPayload: res.qrUrl ?? null, qrDataUri,
    },
  })
}

const HANDLERS = {
  'order.completed': onOrderCompleted,
  'donation.created': onDonationCreated,
}
