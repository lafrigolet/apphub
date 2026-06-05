const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, series_id, number, num_serie, type,
  billing_fact_id, bill_id, device_id, session_id, currency, subtotal_cents,
  tax_cents, total_cents, tax_breakdown, issuer, receptor_nif, receptor_name,
  receptor_address, converted_from_receipt_id, status, verifactu_status,
  verifactu_num_serie, qr_payload, qr_data_uri, issued_by, issued_at,
  created_at, updated_at
`

const LINE_COLUMNS = `
  id, receipt_id, sku, name, qty, unit_price_cents, tax_rate,
  line_base_cents, line_tax_cents, modifiers
`

export async function insert(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.receipts
       (app_id, tenant_id, sub_tenant_id, series_id, number, num_serie, type,
        billing_fact_id, bill_id, device_id, session_id, currency,
        subtotal_cents, tax_cents, total_cents, tax_breakdown, issuer,
        receptor_nif, receptor_name, receptor_address, converted_from_receipt_id, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     RETURNING ${COLUMNS}`,
    [r.appId, r.tenantId, r.subTenantId ?? null, r.seriesId, r.number, r.numSerie, r.type,
     r.billingFactId ?? null, r.billId, r.deviceId ?? null, r.sessionId ?? null,
     r.currency ?? 'EUR', r.subtotalCents, r.taxCents, r.totalCents,
     JSON.stringify(r.taxBreakdown ?? []), JSON.stringify(r.issuer),
     r.receptorNif ?? null, r.receptorName ?? null, r.receptorAddress ?? null,
     r.convertedFromReceiptId ?? null, r.issuedBy ?? null],
  )
  return rows[0]
}

export async function insertLines(client, receipt, lines) {
  const out = []
  for (const l of lines) {
    const { rows } = await client.query(
      `INSERT INTO ${SCHEMA}.receipt_lines
         (app_id, tenant_id, sub_tenant_id, receipt_id, sku, name, qty,
          unit_price_cents, tax_rate, line_base_cents, line_tax_cents, modifiers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${LINE_COLUMNS}`,
      [receipt.app_id, receipt.tenant_id, receipt.sub_tenant_id ?? null, receipt.id,
       l.sku ?? null, l.name, l.qty, l.unitPriceCents, l.taxRate,
       l.lineBaseCents, l.lineTaxCents, l.modifiers ? JSON.stringify(l.modifiers) : null],
    )
    out.push(rows[0])
  }
  return out
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.receipts WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function listLines(client, receiptId) {
  const { rows } = await client.query(
    `SELECT ${LINE_COLUMNS} FROM ${SCHEMA}.receipt_lines
      WHERE receipt_id = $1 ORDER BY created_at, id`,
    [receiptId],
  )
  return rows
}

export async function list(client, { type, sessionId, status, from, to, limit = 100, offset = 0 } = {}) {
  const conds = []
  const params = []
  if (type)      { params.push(type);      conds.push(`type = $${params.length}`) }
  if (sessionId) { params.push(sessionId); conds.push(`session_id = $${params.length}`) }
  if (status)    { params.push(status);    conds.push(`status = $${params.length}`) }
  if (from)      { params.push(from);      conds.push(`issued_at >= $${params.length}`) }
  if (to)        { params.push(to);        conds.push(`issued_at <= $${params.length}`) }
  params.push(limit, offset)
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.receipts ${where}
     ORDER BY issued_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function setStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.receipts SET status = $2, updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status],
  )
  return rows[0] ?? null
}

// Único UPDATE permitido sobre el snapshot: los campos fiscales async que
// llegan de platform/verifactu (grants column-level en la migración 0001).
export async function setVerifactu(client, id, { status, numSerie, qrPayload, qrDataUri }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.receipts
        SET verifactu_status = $2,
            verifactu_num_serie = COALESCE($3, verifactu_num_serie),
            qr_payload = COALESCE($4, qr_payload),
            qr_data_uri = COALESCE($5, qr_data_uri),
            updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status, numSerie ?? null, qrPayload ?? null, qrDataUri ?? null],
  )
  return rows[0] ?? null
}
