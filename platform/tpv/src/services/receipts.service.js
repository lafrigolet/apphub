import { NotFoundError, ConflictError, ValidationError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import { publishEvent } from '../lib/redis.js'
import * as receiptsRepo from '../repositories/receipts.repository.js'
import * as factsRepo from '../repositories/billing-facts.repository.js'
import * as seriesRepo from '../repositories/number-series.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'

function formatNumSerie(prefix, code, number) {
  return `${prefix ?? ''}${code}-${String(number).padStart(6, '0')}`
}

function buildIssuer(settings) {
  if (!settings.issuer_nif || !settings.issuer_name) {
    throw new ConflictError('Fiscal issuer not configured — set issuer_nif and issuer_name in /v1/tpv/settings first')
  }
  return {
    nif: settings.issuer_nif,
    name: settings.issuer_name,
    address: settings.issuer_address ?? null,
    postalCode: settings.issuer_postal_code ?? null,
    city: settings.issuer_city ?? null,
    country: settings.issuer_country ?? 'ES',
  }
}

// Líneas snapshot a partir del fact. pos aplica un tipo de IVA único por
// cuenta (default_tax_rate / metadata.taxRate): el tipo efectivo se deriva
// de los totales del fact y se snapshotea por línea.
function buildLines(fact) {
  const subtotal = Number(fact.subtotal_cents)
  const tax = Number(fact.tax_cents)
  const rate = subtotal > 0 ? Math.round((tax / subtotal) * 10000) / 100 : 0
  const lines = (fact.lines ?? []).map((l) => {
    const base = Number(l.unitPriceCents ?? 0) * Number(l.qty ?? 1)
    return {
      sku: l.sku ?? null,
      name: l.name,
      qty: Number(l.qty ?? 1),
      unitPriceCents: Number(l.unitPriceCents ?? 0),
      taxRate: rate,
      lineBaseCents: base,
      lineTaxCents: Math.round((base * rate) / 100),
      modifiers: l.modifiers ?? null,
    }
  })
  const taxBreakdown = [{ rate, baseCents: subtotal, quotaCents: tax }]
  return { lines, taxBreakdown }
}

export function buildIssuedPayload(receipt, lines) {
  return {
    appId: receipt.app_id,
    tenantId: receipt.tenant_id,
    subTenantId: receipt.sub_tenant_id ?? null,
    receiptId: receipt.id,
    numSerie: receipt.num_serie,
    type: receipt.type,
    fechaExpedicion: receipt.issued_at,
    issuer: receipt.issuer,
    receptor: receipt.receptor_nif
      ? { nif: receipt.receptor_nif, name: receipt.receptor_name, address: receipt.receptor_address ?? null }
      : null,
    currency: receipt.currency,
    subtotalCents: Number(receipt.subtotal_cents),
    taxCents: Number(receipt.tax_cents),
    totalCents: Number(receipt.total_cents),
    taxBreakdown: receipt.tax_breakdown,
    lines: lines.map((l) => ({
      sku: l.sku, name: l.name, qty: l.qty,
      unitPriceCents: Number(l.unit_price_cents), taxRate: Number(l.tax_rate),
      lineBaseCents: Number(l.line_base_cents), lineTaxCents: Number(l.line_tax_cents),
    })),
    deviceId: receipt.device_id ?? null,
    sessionId: receipt.session_id ?? null,
    billId: receipt.bill_id,
  }
}

// Núcleo transaccional de emisión — reutilizado por la ruta (tenant tx) y
// por el auto-issue del handler de eventos (staff bypass). El correlativo se
// consume con el lock de fila de number_series en la MISMA transacción que
// el INSERT del recibo: sin huecos por diseño.
export async function issueReceiptCore(client, scope, { fact, type, receptor, seriesCode, issuedBy }) {
  if (fact.status !== 'pending') throw new ConflictError(`Billing fact is ${fact.status}`)
  if (type === 'invoice' && (!receptor?.nif || !receptor?.name)) {
    throw new ValidationError('Full invoice requires receptor nif and name')
  }

  const settings = await settingsRepo.getOrDefaultsExplicit(client, scope.appId, scope.tenantId)
  const issuer = buildIssuer(settings)

  const code = seriesCode
    ?? (type === 'invoice' ? settings.default_invoice_series_code : settings.default_simplified_series_code)
  const series = await seriesRepo.findByCodeExplicit(client, scope.appId, scope.tenantId, code)
  if (!series) throw new ConflictError(`Numbering series '${code}' not found — create it in /v1/tpv/series first`)
  if (series.kind !== type) throw new ConflictError(`Series '${code}' is for ${series.kind}, not ${type}`)

  const seq = await seriesRepo.consumeNextNumber(client, series.id)
  if (!seq) throw new ConflictError(`Series '${code}' is not active`)
  const number = Number(seq.number)

  const { lines, taxBreakdown } = buildLines(fact)

  const receipt = await receiptsRepo.insert(client, {
    appId: scope.appId,
    tenantId: scope.tenantId,
    subTenantId: fact.sub_tenant_id ?? scope.subTenantId ?? null,
    seriesId: series.id,
    number,
    numSerie: formatNumSerie(seq.prefix, seq.code, number),
    type,
    billingFactId: fact.id,
    billId: fact.bill_id,
    deviceId: fact.device_id ?? null,
    sessionId: fact.session_id ?? null,
    currency: fact.currency,
    subtotalCents: Number(fact.subtotal_cents),
    taxCents: Number(fact.tax_cents),
    totalCents: Number(fact.total_cents),
    taxBreakdown,
    issuer,
    receptorNif: receptor?.nif ?? null,
    receptorName: receptor?.name ?? null,
    receptorAddress: receptor?.address ?? null,
    issuedBy: issuedBy ?? null,
  })
  const insertedLines = await receiptsRepo.insertLines(client, receipt, lines)
  await factsRepo.markReceipted(client, fact.id, receipt.id)
  return { receipt, lines: insertedLines }
}

export async function issueReceipt(identity, { billingFactId, type, receptor, seriesCode }) {
  const scope = { appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null }
  const { receipt, lines } = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const fact = await factsRepo.findById(c, billingFactId)
    if (!fact) throw new NotFoundError('Billing fact not found')
    return issueReceiptCore(c, scope, { fact, type, receptor, seriesCode, issuedBy: identity.userId })
  })
  await publishEvent('tpv.receipt.issued', buildIssuedPayload(receipt, lines))
  return { ...receipt, lines }
}

export async function listReceipts(identity, filters) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    receiptsRepo.list(c, filters))
}

export async function getReceipt(identity, id) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const receipt = await receiptsRepo.findById(c, id)
    if (!receipt) throw new NotFoundError('Receipt not found')
    const lines = await receiptsRepo.listLines(c, id)
    return { ...receipt, lines }
  })
}

// Canje ticket simplificado → factura completa (dentro del plazo del tenant).
// El simplificado original queda en status 'converted'; la factura es un
// documento nuevo con su propio correlativo de la serie de facturas.
export async function convertReceipt(identity, id, { receptor, seriesCode }) {
  const scope = { appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null }
  if (!receptor?.nif || !receptor?.name) {
    throw new ValidationError('Full invoice requires receptor nif and name')
  }
  const { receipt, lines } = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const original = await receiptsRepo.findById(c, id)
    if (!original) throw new NotFoundError('Receipt not found')
    if (original.type !== 'simplified') throw new ConflictError('Only simplified receipts can be converted')
    if (original.status !== 'issued') throw new ConflictError(`Receipt is ${original.status}`)

    const settings = await settingsRepo.getOrDefaultsExplicit(c, scope.appId, scope.tenantId)
    const windowDays = Number(settings.convert_window_days)
    const ageMs = Date.now() - new Date(original.issued_at).getTime()
    if (ageMs > windowDays * 24 * 3600 * 1000) {
      throw new ConflictError(`Conversion window of ${windowDays} days has passed`)
    }

    const code = seriesCode ?? settings.default_invoice_series_code
    const series = await seriesRepo.findByCodeExplicit(c, scope.appId, scope.tenantId, code)
    if (!series) throw new ConflictError(`Numbering series '${code}' not found — create it in /v1/tpv/series first`)
    if (series.kind !== 'invoice') throw new ConflictError(`Series '${code}' is for ${series.kind}, not invoice`)

    const seq = await seriesRepo.consumeNextNumber(c, series.id)
    if (!seq) throw new ConflictError(`Series '${code}' is not active`)
    const number = Number(seq.number)

    const originalLines = await receiptsRepo.listLines(c, id)
    const invoice = await receiptsRepo.insert(c, {
      appId: scope.appId,
      tenantId: scope.tenantId,
      subTenantId: original.sub_tenant_id ?? null,
      seriesId: series.id,
      number,
      numSerie: formatNumSerie(seq.prefix, seq.code, number),
      type: 'invoice',
      billingFactId: original.billing_fact_id,
      billId: original.bill_id,
      deviceId: original.device_id,
      sessionId: original.session_id,
      currency: original.currency,
      subtotalCents: Number(original.subtotal_cents),
      taxCents: Number(original.tax_cents),
      totalCents: Number(original.total_cents),
      taxBreakdown: original.tax_breakdown,
      issuer: original.issuer, // mismo emisor que el documento canjeado
      receptorNif: receptor.nif,
      receptorName: receptor.name,
      receptorAddress: receptor.address ?? null,
      convertedFromReceiptId: original.id,
      issuedBy: identity.userId,
    })
    const invoiceLines = await receiptsRepo.insertLines(c, invoice, originalLines.map((l) => ({
      sku: l.sku, name: l.name, qty: l.qty,
      unitPriceCents: Number(l.unit_price_cents), taxRate: Number(l.tax_rate),
      lineBaseCents: Number(l.line_base_cents), lineTaxCents: Number(l.line_tax_cents),
      modifiers: l.modifiers,
    })))
    await receiptsRepo.setStatus(c, original.id, 'converted')
    return { receipt: invoice, lines: invoiceLines }
  })
  await publishEvent('tpv.receipt.issued', buildIssuedPayload(receipt, lines))
  return { ...receipt, lines }
}

// Reenvío idempotente: NO emite documento nuevo — publica el snapshot para
// que notifications lo entregue por email.
export async function resendReceipt(identity, id, { email }) {
  const { receipt, lines } = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const receipt = await receiptsRepo.findById(c, id)
    if (!receipt) throw new NotFoundError('Receipt not found')
    return { receipt, lines: await receiptsRepo.listLines(c, id) }
  })
  await publishEvent('tpv.receipt.send_requested', {
    ...buildIssuedPayload(receipt, lines),
    email,
    requestedBy: identity.userId,
  })
  return { queued: true, receiptId: id, email }
}
