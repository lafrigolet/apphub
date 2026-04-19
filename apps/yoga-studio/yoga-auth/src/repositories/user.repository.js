export async function findByEmail(client, email, tenantId) {
  const { rows } = await client.query(
    'SELECT * FROM yoga_auth.users WHERE email = $1 AND tenant_id = $2',
    [email, tenantId],
  )
  return rows[0] ?? null
}

export async function findById(client, id, tenantId) {
  const { rows } = await client.query(
    'SELECT id, email, role, email_confirmed, tenant_id, sub_tenant_id, created_at FROM yoga_auth.users WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0] ?? null
}

export async function createUser(client, { id, email, passwordHash, role, tenantId, subTenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_auth.users (id, email, password_hash, role, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, role, email_confirmed, tenant_id, sub_tenant_id, created_at`,
    [id, email, passwordHash, role, tenantId, subTenantId ?? null],
  )
  return rows[0]
}

export async function incrementFailedAttempts(client, id) {
  await client.query(
    `UPDATE yoga_auth.users
     SET failed_attempts = failed_attempts + 1,
         locked_until = CASE WHEN failed_attempts + 1 >= 5
           THEN NOW() + INTERVAL '10 minutes' ELSE locked_until END
     WHERE id = $1`,
    [id],
  )
}

export async function resetFailedAttempts(client, id) {
  await client.query(
    `UPDATE yoga_auth.users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [id],
  )
}

export async function confirmEmail(client, id) {
  await client.query(
    `UPDATE yoga_auth.users SET email_confirmed = true WHERE id = $1`,
    [id],
  )
}

export async function updatePassword(client, id, passwordHash) {
  await client.query(
    `UPDATE yoga_auth.users SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [id, passwordHash],
  )
}
