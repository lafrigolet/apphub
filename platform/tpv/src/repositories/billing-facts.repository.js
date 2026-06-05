const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, bill_id, device_id, session_id,
  currency, subtotal_cents, tax_cents, tip_cents, total_cents,
  payments, lines, bill_metadata, status, attributed, receipt_id,
  created_at, updated_at
`

// Idempotente frente a reentrega del evento: ON CONFLICT (app, tenant, bill)
// devuelve NULL y el handler no repite la imputación de efectivo.
export async function insertIfAbsent(client, f) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.billing_facts
       (app_id, tenant_id, sub_tenant_id, bill_id, device_id, session_id, currency,
        subtotal_cents, tax_cents, tip_cents, total_cents, payments, lines,
        bill_metadata, attributed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (app_id, tenant_id, bill_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [f.appId, f.tenantId, f.subTenantId ?? null, f.billId, f.deviceId ?? null,
     f.sessionId ?? null, f.currency ?? 'EUR', f.subtotalCents ?? 0, f.taxCents ?? 0,
     f.tipCents ?? 0, f.totalCents ?? 0, JSON.stringify(f.payments ?? []),
     JSON.stringify(f.lines ?? []), JSON.stringify(f.billMetadata ?? {}),
     f.attributed ?? false],
  )
  return rows[0] ?? null
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.billing_facts WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function list(client, { status, orphan, limit = 100, offset = 0 } = {}) {
  const conds = []
  const params = []
  if (status) { params.push(status); conds.push(`status = $${params.length}`) }
  if (orphan === true) conds.push('session_id IS NULL')
  params.push(limit, offset)
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.billing_facts ${where}
     ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function attribute(client, id, sessionId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.billing_facts
        SET session_id = $2, attributed = TRUE, updated_at = now()
      WHERE id = $1 AND session_id IS NULL
      RETURNING ${COLUMNS}`,
    [id, sessionId],
  )
  return rows[0] ?? null
}

export async function markCancelled(client, appId, tenantId, billId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.billing_facts
        SET status = 'cancelled', updated_at = now()
      WHERE app_id = $1 AND tenant_id = $2 AND bill_id = $3 AND status = 'pending'
      RETURNING ${COLUMNS}`,
    [appId, tenantId, billId],
  )
  return rows[0] ?? null
}

export async function markReceipted(client, id, receiptId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.billing_facts
        SET status = 'receipted', receipt_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING ${COLUMNS}`,
    [id, receiptId],
  )
  return rows[0] ?? null
}
