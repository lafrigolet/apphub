import { publish } from '@apphub/platform-sdk/redis'
import { logger } from '../lib/logger.js'
import { generarQrDataUri } from '../lib/qr.js'
import { crearRegistro } from './verifactu.service.js'

const PATTERN = '*.events'

// Subscriber a los eventos fiscales de platform/tpv (ADR 015). Cada recibo
// emitido genera un registro de facturación encadenado (alta); cada abono,
// una rectificativa (alta R1 con importe negativo — evitamos el registro de
// anulación porque los abonos pueden ser parciales y la anulación AEAT es
// total y única por factura). Fire-and-forget: tpv no espera — recibe el QR
// async vía verifactu.registro.created, o marca failed vía *.failed.
export function startTpvEventsHandler({ redis }) {
  const sub = redis.duplicate()
  sub.psubscribe(PATTERN, (err) => {
    if (err) {
      logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe')
      return
    }
    logger.info({ pattern: PATTERN }, 'verifactu subscribed to tpv events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (!event?.type?.startsWith('tpv.receipt.')) return

    try {
      switch (event.type) {
        case 'tpv.receipt.issued': await onReceiptIssued(event, redis); break
        case 'tpv.receipt.voided': await onReceiptVoided(event, redis); break
        default: break
      }
    } catch (err) {
      logger.error({ err, type: event.type, channel }, 'verifactu tpv event handler failed')
      await publishFailed(redis, event).catch(() => {})
    }
  })

  return sub
}

const toEuros = (cents) => (Number(cents ?? 0) / 100).toFixed(2)
const toIsoDate = (ts) => String(ts ?? '').slice(0, 10)

async function onReceiptIssued(event, redis) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.receiptId || !p.numSerie) return
  const scope = { appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null }

  const res = await crearRegistro(scope, {
    tipo: 'alta',
    numSerie: p.numSerie,
    // factura simplificada = F2; factura completa = F1 (catálogo AEAT)
    tipoFactura: p.type === 'invoice' ? 'F1' : 'F2',
    idEmisor: p.issuer?.nif,
    clienteNif: p.receptor?.nif ?? null,
    clienteNombre: p.receptor?.name ?? null,
    fechaExpedicion: toIsoDate(p.fechaExpedicion),
    importeTotal: toEuros(p.totalCents),
    cuotaTotal: toEuros(p.taxCents),
    totalDisplay: `${toEuros(p.totalCents)} €`,
  })

  const qrDataUri = res.qrUrl ? await generarQrDataUri(res.qrUrl) : null
  await publish(redis, 'platform', {
    type: 'verifactu.registro.created',
    payload: {
      appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null,
      receiptId: p.receiptId,
      numSerie: res.serie,
      huella: res.huella,
      qrPayload: res.qrUrl ?? null,
      qrDataUri,
    },
  })
}

async function onReceiptVoided(event, redis) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.creditNoteId || !p.numSerie) return
  const scope = { appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null }

  const res = await crearRegistro(scope, {
    tipo: 'alta',
    numSerie: p.numSerie,                  // serie propia del abono (R-…)
    tipoFactura: 'R1',                     // rectificativa por error fundado / devolución
    idEmisor: p.issuer?.nif,
    clienteNif: p.receptor?.nif ?? null,
    clienteNombre: p.receptor?.name ?? null,
    fechaExpedicion: toIsoDate(p.issuedAt),
    importeTotal: `-${toEuros(p.amountCents)}`,
    cuotaTotal: null,
    totalDisplay: `-${toEuros(p.amountCents)} €`,
  })

  const qrDataUri = res.qrUrl ? await generarQrDataUri(res.qrUrl) : null
  await publish(redis, 'platform', {
    type: 'verifactu.registro.created',
    payload: {
      appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null,
      creditNoteId: p.creditNoteId,
      originalReceiptId: p.originalReceiptId ?? null,
      numSerie: res.serie,
      huella: res.huella,
      qrPayload: res.qrUrl ?? null,
      qrDataUri,
    },
  })
}

async function publishFailed(redis, event) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId) return
  await publish(redis, 'platform', {
    type: 'verifactu.registro.failed',
    payload: {
      appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null,
      receiptId: p.receiptId ?? null,
      creditNoteId: p.creditNoteId ?? null,
    },
  })
}
