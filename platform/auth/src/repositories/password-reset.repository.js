const SCHEMA = 'platform_auth'

export async function createReset(client, { id, userId, appId, tenantId, expiresAt }) {
  await client.query(
    `INSERT INTO ${SCHEMA}.password_resets (id, user_id, app_id, tenant_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, appId, tenantId, expiresAt],
  )
}

export async function findValidReset(client, token) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.password_resets
     WHERE id = $1 AND used_at IS NULL AND expires_at > now() LIMIT 1`,
    [token],
  )
  return rows[0] ?? null
}

export async function markResetUsed(client, token) {
  await client.query(
    `UPDATE ${SCHEMA}.password_resets SET used_at = now() WHERE id = $1`,
    [token],
  )
}
