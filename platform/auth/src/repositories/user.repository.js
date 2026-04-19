const SCHEMA = 'platform_auth'

export async function findByEmail(client, appId, tenantId, email) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.users WHERE app_id = $1 AND tenant_id = $2 AND email = $3 LIMIT 1`,
    [appId, tenantId, email],
  )
  return rows[0] ?? null
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.users WHERE app_id = $1 AND tenant_id = $2 AND id = $3 LIMIT 1`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function createUser(client, { id, appId, tenantId, subTenantId, email, passwordHash, role }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.users
       (id, app_id, tenant_id, sub_tenant_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, app_id, tenant_id, sub_tenant_id, email, role, created_at`,
    [id, appId, tenantId, subTenantId ?? null, email, passwordHash, role],
  )
  return rows[0]
}

export async function incrementFailedAttempts(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
     WHERE id = $1`,
    [id],
  )
}

export async function resetFailedAttempts(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [id],
  )
}

export async function updatePassword(client, id, passwordHash) {
  await client.query(
    `UPDATE ${SCHEMA}.users SET password_hash = $1 WHERE id = $2`,
    [passwordHash, id],
  )
}
