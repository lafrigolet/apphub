const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, series_id, number, num_serie,
  original_receipt_id, reason, amount_cents, lines, refund_method,
  refund_external_ref, status, requested_by, authorized_by,
  verifactu_status, verifactu_num_serie, qr_payload, qr_data_uri,
  issued_at, created_at, updated_at
`

export async function insert(client, n) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.credit_notes
       (app_id, tenant_id, sub_tenant_id, original_receipt_id, reason,
        amount_cents, lines, refund_method, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [n.appId, n.tenantId, n.subTenantId ?? null, n.originalReceiptId, n.reason,
     n.amountCents, JSON.stringify(n.lines ?? []), n.refundMethod, n.requestedBy ?? null],
  )
  return rows[0]
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.credit_notes WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function list(client, { status, originalReceiptId, from, to, limit = 100, offset = 0 } = {}) {
  const conds = []
  const params = []
  if (status)            { params.push(status);            conds.push(`status = $${params.length}`) }
  if (originalReceiptId) { params.push(originalReceiptId); conds.push(`original_receipt_id = $${params.length}`) }
  if (from)              { params.push(from);              conds.push(`created_at >= $${params.length}`) }
  if (to)                { params.push(to);                conds.push(`created_at <= $${params.length}`) }
  params.push(limit, offset)
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.credit_notes ${where}
     ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// Total abonado (autorizado) contra un recibo — para impedir sobre-abono.
export async function sumAuthorizedByReceipt(client, originalReceiptId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
       FROM ${SCHEMA}.credit_notes
      WHERE original_receipt_id = $1 AND status IN ('pending', 'authorized')`,
    [originalReceiptId],
  )
  return Number(rows[0].total)
}

export async function authorize(client, id, { authorizedBy, seriesId, number, numSerie, refundExternalRef }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.credit_notes
        SET status = 'authorized', authorized_by = $2, series_id = $3, number = $4,
            num_serie = $5, refund_external_ref = COALESCE($6, refund_external_ref),
            issued_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING ${COLUMNS}`,
    [id, authorizedBy, seriesId, number, numSerie, refundExternalRef ?? null],
  )
  return rows[0] ?? null
}

export async function reject(client, id, { authorizedBy }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.credit_notes
        SET status = 'rejected', authorized_by = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING ${COLUMNS}`,
    [id, authorizedBy],
  )
  return rows[0] ?? null
}

export async function setVerifactu(client, id, { status, numSerie, qrPayload, qrDataUri }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.credit_notes
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
