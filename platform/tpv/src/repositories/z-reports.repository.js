const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, session_id, number, snapshot, generated_at
`

// Numeración de informes Z por tenant: MAX+1 dentro de la transacción de
// cierre. Dos cierres simultáneos de sesiones distintas pueden chocar en el
// UNIQUE(app, tenant, number) — el caller reintenta una vez.
export async function nextNumber(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(number), 0) + 1 AS next
       FROM ${SCHEMA}.z_reports WHERE app_id = $1 AND tenant_id = $2`,
    [appId, tenantId],
  )
  return Number(rows[0].next)
}

export async function insert(client, z) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.z_reports
       (app_id, tenant_id, sub_tenant_id, session_id, number, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [z.appId, z.tenantId, z.subTenantId ?? null, z.sessionId, z.number, JSON.stringify(z.snapshot)],
  )
  return rows[0]
}

export async function findBySession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.z_reports WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  )
  return rows[0] ?? null
}
