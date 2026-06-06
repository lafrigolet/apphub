const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, session_id, counted_by, counted,
  expected_cents, variance_cents, note, counted_at
`

export async function insert(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.cash_counts
       (app_id, tenant_id, sub_tenant_id, session_id, counted_by, counted,
        expected_cents, variance_cents, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [c.appId, c.tenantId, c.subTenantId ?? null, c.sessionId, c.countedBy,
     JSON.stringify(c.counted), c.expectedCents, c.varianceCents, c.note ?? null],
  )
  return rows[0]
}

export async function listBySession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.cash_counts
      WHERE session_id = $1 ORDER BY counted_at`,
    [sessionId],
  )
  return rows
}
