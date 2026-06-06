const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, session_id, kind, amount_cents,
  reason, actor_id, source, billing_fact_id, receipt_id, created_at
`

export async function insert(client, m) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.cash_movements
       (app_id, tenant_id, sub_tenant_id, session_id, kind, amount_cents,
        reason, actor_id, source, billing_fact_id, receipt_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLUMNS}`,
    [m.appId, m.tenantId, m.subTenantId ?? null, m.sessionId, m.kind, m.amountCents,
     m.reason ?? null, m.actorId ?? null, m.source ?? 'manual',
     m.billingFactId ?? null, m.receiptId ?? null],
  )
  return rows[0]
}

export async function listBySession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.cash_movements
      WHERE session_id = $1 ORDER BY created_at`,
    [sessionId],
  )
  return rows
}

// Efectivo teórico en caja = fondo inicial (movimiento opening_float) +
// ventas cash + entradas − salidas − devoluciones (importes con signo).
export async function sumCashBySession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
       FROM ${SCHEMA}.cash_movements WHERE session_id = $1`,
    [sessionId],
  )
  return Number(rows[0].total)
}
