const SCHEMA = 'platform_auth'

const COLUMNS = `
  id, user_id, app_id, tenant_id, token_hash, expires_at, consumed_at, created_at
`

export async function create(client, { id, userId, appId, tenantId, tokenHash, expiresAt }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.activation_tokens
       (id, user_id, app_id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [id, userId, appId, tenantId, tokenHash, expiresAt],
  )
  return rows[0]
}

export async function findValidByHash(client, tokenHash) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.activation_tokens
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

export async function findAnyByHash(client, tokenHash) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.activation_tokens
     WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

export async function markConsumed(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.activation_tokens SET consumed_at = now() WHERE id = $1`,
    [id],
  )
}

// Invalida todos los tokens activos del usuario. Lo usa el endpoint
// "Reenviar magic-link" antes de emitir uno nuevo.
export async function revokeAllForUser(client, userId) {
  await client.query(
    `UPDATE ${SCHEMA}.activation_tokens
     SET consumed_at = now()
     WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  )
}
