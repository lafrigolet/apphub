export async function findById(client, id, tenantId) {
  const { rows } = await client.query(
    'SELECT id, name, email, phone, avatar_url, role, preferences, created_at, updated_at FROM yoga_users.profiles WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0] ?? null
}

export async function upsertProfile(client, { id, name, email, phone, avatarUrl, role, preferences, tenantId, subTenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_users.profiles (id, name, email, phone, avatar_url, role, preferences, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       phone = COALESCE(EXCLUDED.phone, yoga_users.profiles.phone),
       avatar_url = COALESCE(EXCLUDED.avatar_url, yoga_users.profiles.avatar_url),
       role = EXCLUDED.role,
       preferences = COALESCE(EXCLUDED.preferences, yoga_users.profiles.preferences),
       updated_at = now()
     RETURNING *`,
    [id, name, email, phone ?? null, avatarUrl ?? null, role,
     preferences ? JSON.stringify(preferences) : null, tenantId, subTenantId ?? null],
  )
  return rows[0]
}

export async function updateProfile(client, id, tenantId, fields) {
  const sets = []
  const values = []
  let i = 1

  if (fields.name !== undefined) { sets.push(`name = $${i++}`); values.push(fields.name) }
  if (fields.phone !== undefined) { sets.push(`phone = $${i++}`); values.push(fields.phone) }
  if (fields.avatarUrl !== undefined) { sets.push(`avatar_url = $${i++}`); values.push(fields.avatarUrl) }
  if (fields.preferences !== undefined) { sets.push(`preferences = $${i++}`); values.push(JSON.stringify(fields.preferences)) }
  sets.push('updated_at = now()')
  values.push(id)
  values.push(tenantId)

  const { rows } = await client.query(
    `UPDATE yoga_users.profiles SET ${sets.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`,
    values,
  )
  return rows[0] ?? null
}

export async function searchProfiles(client, tenantId, { search, limit = 20, offset = 0 }) {
  const { rows } = await client.query(
    `SELECT id, name, email, phone, role, created_at FROM yoga_users.profiles
     WHERE tenant_id = $1 AND ($2::text IS NULL OR name ILIKE $2 OR email ILIKE $2)
     ORDER BY name LIMIT $3 OFFSET $4`,
    [tenantId, search ? `%${search}%` : null, limit, offset],
  )
  return rows
}

export async function getHistory(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT id, booking_id, class_name, instructor, attended_at
     FROM yoga_users.class_history
     WHERE user_id = $1 AND tenant_id = $2
     ORDER BY attended_at DESC
     LIMIT 20`,
    [userId, tenantId],
  )
  return rows
}

export async function addHistory(client, { userId, bookingId, className, instructor, attendedAt, tenantId, subTenantId }) {
  await client.query(
    `INSERT INTO yoga_users.class_history (user_id, booking_id, class_name, instructor, attended_at, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (booking_id) DO NOTHING`,
    [userId, bookingId, className, instructor, attendedAt, tenantId, subTenantId ?? null],
  )
}
