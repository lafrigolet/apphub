const SCHEMA = 'platform_auth'

const PUBLIC_COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, email, role,
  display_name, last_login_at, revoked_at, failed_login_attempts, locked_until,
  created_at, updated_at
`

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

export async function createUser(client, { id, appId, tenantId, subTenantId, email, passwordHash, role, displayName }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.users
       (id, app_id, tenant_id, sub_tenant_id, email, password_hash, role, display_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, app_id, tenant_id, sub_tenant_id, email, role, display_name, created_at`,
    [id, appId, tenantId, subTenantId ?? null, email, passwordHash, role, displayName ?? null],
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

export async function touchLastLogin(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.users SET last_login_at = now() WHERE id = $1`,
    [id],
  )
}

export async function list(client, { appId, tenantId, role }) {
  const conditions = []
  const values = []
  let idx = 1
  if (appId)    { conditions.push(`app_id    = $${idx++}`); values.push(appId) }
  if (tenantId) { conditions.push(`tenant_id = $${idx++}`); values.push(tenantId) }
  if (role) {
    const roles = Array.isArray(role) ? role : [role]
    const placeholders = roles.map(() => `$${idx++}`).join(', ')
    conditions.push(`role IN (${placeholders})`)
    values.push(...roles)
  }
  conditions.push(`revoked_at IS NULL`)
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS} FROM ${SCHEMA}.users
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at`,
    values,
  )
  return rows
}

export async function findAnywhereById(client, id) {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS} FROM ${SCHEMA}.users WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function updateRole(client, id, role) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.users SET role = $2, updated_at = now()
     WHERE id = $1
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, role],
  )
  return rows[0] ?? null
}

export async function softDelete(client, id) {
  const { rowCount } = await client.query(
    `UPDATE ${SCHEMA}.users SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  )
  return rowCount > 0
}
