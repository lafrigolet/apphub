export async function createReset(client, { token, userId, expiresAt, tenantId, subTenantId }) {
  await client.query(
    `INSERT INTO yoga_auth.password_resets (token, user_id, expires_at, tenant_id, sub_tenant_id) VALUES ($1, $2, $3, $4, $5)`,
    [token, userId, expiresAt, tenantId, subTenantId ?? null],
  )
}

export async function findValidReset(client, token) {
  const { rows } = await client.query(
    `SELECT * FROM yoga_auth.password_resets
     WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [token],
  )
  return rows[0] ?? null
}

export async function markResetUsed(client, token) {
  await client.query(
    `UPDATE yoga_auth.password_resets SET used_at = NOW() WHERE token = $1`,
    [token],
  )
}
