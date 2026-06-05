import { logger } from '../lib/logger.js'
import { withStaffBypass } from '../lib/db.js'
import { publishEvent } from '../lib/redis.js'
import * as factsRepo from '../repositories/billing-facts.repository.js'
import * as devicesRepo from '../repositories/devices.repository.js'
import * as sessionsRepo from '../repositories/cash-sessions.repository.js'
import * as movementsRepo from '../repositories/cash-movements.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import { issueReceiptCore, buildIssuedPayload } from './receipts.service.js'

const PATTERN = '*.events'

// Subscriber a los eventos de platform/pos (mismo patrón que
// platform/donations/src/services/splitpay-events.handler.js). El motor de
// cuentas vive en pos; tpv materializa cada bill pagado como billing_fact
// (cola de emisión de recibos) e imputa el efectivo a la sesión de caja
// del dispositivo (metadata.deviceId puesto por el frontend TPV).
export function startPosEventsHandler({ redis }) {
  const sub = redis.duplicate()
  sub.psubscribe(PATTERN, (err) => {
    if (err) {
      logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe')
      return
    }
    logger.info({ pattern: PATTERN }, 'tpv subscribed to pos events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (!event?.type?.startsWith('pos.')) return

    try {
      switch (event.type) {
        case 'pos.bill.paid':      await onBillPaid(event);      break
        case 'pos.bill.cancelled': await onBillCancelled(event); break
        default: break
      }
    } catch (err) {
      logger.error({ err, type: event.type, channel }, 'tpv pos event handler failed')
    }
  })

  return sub
}

async function onBillPaid(event) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.billId) return
  // payload legado (pre-enriquecimiento D0): sin payments no hay nada que
  // imputar ni snapshot fiable — se ignora y queda trazado en logs.
  if (!Array.isArray(p.payments)) {
    logger.warn({ billId: p.billId }, 'pos.bill.paid without payments breakdown — skipped (legacy payload?)')
    return
  }

  const issuedPayloads = await withStaffBypass(async (c) => {
    const deviceId = isUuid(p.metadata?.deviceId) ? p.metadata.deviceId : null

    // Bajo staff bypass no hay RLS: verificar tenant del device a mano.
    let device = null
    if (deviceId) {
      const d = await devicesRepo.findById(c, deviceId)
      if (d && d.app_id === p.appId && d.tenant_id === p.tenantId && d.active) device = d
    }

    let session = null
    if (device) {
      const s = await sessionsRepo.findOpenByDevice(c, device.id)
      if (s && s.app_id === p.appId && s.tenant_id === p.tenantId) session = s
    }

    const out = []
    const fact = await factsRepo.insertIfAbsent(c, {
      appId: p.appId,
      tenantId: p.tenantId,
      subTenantId: p.subTenantId ?? null,
      billId: p.billId,
      deviceId: device?.id ?? null,
      sessionId: session?.id ?? null,
      currency: p.currency ?? 'EUR',
      subtotalCents: p.subtotalCents ?? 0,
      taxCents: p.taxCents ?? 0,
      tipCents: p.tipCents ?? 0,
      totalCents: p.totalCents ?? 0,
      payments: p.payments,
      lines: (p.items ?? []).map((i) => ({
        sku: i.sku ?? null, name: i.name, qty: i.qty,
        unitPriceCents: i.unitPriceCents ?? 0, modifiers: i.modifiers ?? null,
        course: i.course ?? null,
      })),
      billMetadata: p.metadata ?? {},
      attributed: Boolean(session),
    })
    if (!fact) return out // reentrega del evento — ya procesado

    // El efectivo entra al cajón: importe + propina en metálico.
    const cashCents = p.payments
      .filter((x) => x.method === 'cash')
      .reduce((s, x) => s + Number(x.amountCents ?? 0) + Number(x.tipCents ?? 0), 0)

    if (session && cashCents > 0) {
      await movementsRepo.insert(c, {
        appId: p.appId,
        tenantId: p.tenantId,
        subTenantId: p.subTenantId ?? null,
        sessionId: session.id,
        kind: 'sale_cash',
        amountCents: cashCents,
        reason: `Venta bill ${p.billId}`,
        source: 'event',
        billingFactId: fact.id,
      })
    } else if (cashCents > 0) {
      logger.warn({ billId: p.billId, deviceId: p.metadata?.deviceId ?? null },
        'cash payment without open session — billing_fact left unattributed')
    }

    // Emisión automática del ticket simplificado si el tenant lo activó.
    // Falla blando: un problema de emisión (emisor sin configurar, serie
    // inexistente) no debe perder el fact — queda pending para emisión manual.
    const settings = await settingsRepo.getOrDefaultsExplicit(c, p.appId, p.tenantId)
    if (settings.auto_issue_simplified) {
      try {
        const scope = { appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null }
        const { receipt, lines } = await issueReceiptCore(c, scope, { fact, type: 'simplified' })
        out.push(buildIssuedPayload(receipt, lines))
      } catch (err) {
        logger.warn({ err: err.message, billId: p.billId }, 'auto-issue failed — fact left pending')
      }
    }
    return out
  })

  // publish tras COMMIT: nunca anunciamos recibos de transacciones abortadas.
  for (const payload of issuedPayloads ?? []) {
    await publishEvent('tpv.receipt.issued', payload)
  }
}

async function onBillCancelled(event) {
  const p = event.payload ?? {}
  if (!p.appId || !p.tenantId || !p.billId) return
  await withStaffBypass(async (c) => {
    await factsRepo.markCancelled(c, p.appId, p.tenantId, p.billId)
  })
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
