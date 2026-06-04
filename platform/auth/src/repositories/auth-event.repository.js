const SCHEMA = 'platform_auth'

const COLUMNS = `
  id, app_id, tenant_id, user_id, event_type, result, ip, user_agent, metadata, created_at
`

// Inserta un evento de auditoría. El caller decide la transacción/contexto
// RLS; esta función sólo emite el INSERT.
export async function create(client, { id, appId, tenantId, userId = null, eventType, result = 'success', ip = null, userAgent = null, metadata = null }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.auth_events
       (id, app_id, tenant_id, user_id, event_type, result, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [id, appId, tenantId, userId, eventType, result, ip, userAgent, metadata ? JSON.stringify(metadata) : null],
  )
  return rows[0]
}

// Lista los eventos de un usuario (más recientes primero). Scopeado por
// (app_id, tenant_id, user_id) — el caller fija el contexto RLS.
export async function listByUser(client, { appId, tenantId, userId, limit = 50 }) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.auth_events
     WHERE app_id = $1 AND tenant_id = $2 AND user_id = $3
     ORDER BY created_at DESC
     LIMIT $4`,
    [appId, tenantId, userId, limit],
  )
  return rows
}
