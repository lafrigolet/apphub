const SCHEMA = 'platform_auth'

const PUBLIC_COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, email, role,
  display_name, last_login_at, revoked_at, failed_login_attempts, locked_until,
  pending_activation, pending_approval, owner_activated_at,
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

export async function createUser(client, { id, appId, tenantId, subTenantId, email, passwordHash, role, displayName, pendingActivation = false, pendingApproval = false }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.users
       (id, app_id, tenant_id, sub_tenant_id, email, password_hash, role, display_name, pending_activation, pending_approval)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, app_id, tenant_id, sub_tenant_id, email, role, display_name, pending_activation, pending_approval, created_at`,
    [id, appId, tenantId, subTenantId ?? null, email, passwordHash ?? null, role, displayName ?? null, pendingActivation, pendingApproval],
  )
  return rows[0]
}

// Marca al owner como activado tras consumir el magic-link: setea password,
// limpia pending_activation, registra owner_activated_at.
export async function markActivated(client, id, passwordHash) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.users
     SET password_hash      = $2,
         pending_activation = FALSE,
         owner_activated_at = COALESCE(owner_activated_at, now()),
         updated_at         = now()
     WHERE id = $1
     RETURNING id, app_id, tenant_id, sub_tenant_id, email, role, display_name, owner_activated_at`,
    [id, passwordHash],
  )
  return rows[0] ?? null
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

export async function list(client, { appId, tenantId, role, pending }) {
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
  // `pending=approval` → solo solicitudes self-register a la espera del
  // admin. Cualquier otro valor (o ausencia) devuelve users activos.
  if (pending === 'approval') {
    conditions.push(`pending_approval = TRUE`)
  } else {
    conditions.push(`pending_approval = FALSE`)
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

// Hard-delete usado por el flujo de rechazo de solicitudes: el user
// estaba sólo en pending_approval, sin actividad asociada, así que
// borrar el row entero libera el email y permite re-solicitar.
// Las FKs con ON DELETE CASCADE limpian oauth_connections,
// password_resets, activation_tokens.
export async function hardDelete(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.users WHERE id = $1`,
    [id],
  )
  return rowCount > 0
}

export async function approve(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.users SET pending_approval = FALSE, updated_at = now()
     WHERE id = $1 AND pending_approval = TRUE
     RETURNING ${PUBLIC_COLUMNS}`,
    [id],
  )
  return rows[0] ?? null
}

// Self-service profile update — sólo campos seguros (display_name por
// ahora). Email y role NO se pueden cambiar desde aquí: cambio de email
// debería pasar por un flujo de verificación; cambio de role siempre es
// admin/staff. updated_at lo movemos para que la última edición quede en
// audit-able shape.
export async function updateProfile(client, id, { displayName }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.users
     SET display_name = COALESCE($2, display_name),
         updated_at   = now()
     WHERE id = $1
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, displayName ?? null],
  )
  return rows[0] ?? null
}
