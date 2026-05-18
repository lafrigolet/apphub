const SCHEMA = 'platform_auth'

const COLUMNS = `
  id, user_id, app_id, tenant_id, token_hash, expires_at, consumed_at, created_at
`

export async function create(client, { id, userId, appId, tenantId, tokenHash, expiresAt }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.magic_links
       (id, user_id, app_id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [id, userId, appId, tenantId, tokenHash, expiresAt],
  )
  return rows[0]
}

// Busca un magic-link válido (no consumido, no expirado) por hash. El
// caller hashea el token plano que llega del cliente y mira aquí.
export async function findValidByHash(client, tokenHash) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.magic_links
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

// Distingue "no existe" de "ya usado / expirado" — útil para devolver
// mensajes específicos al user (igual que activation_tokens).
export async function findAnyByHash(client, tokenHash) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.magic_links
     WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

export async function markConsumed(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.magic_links SET consumed_at = now() WHERE id = $1`,
    [id],
  )
}
