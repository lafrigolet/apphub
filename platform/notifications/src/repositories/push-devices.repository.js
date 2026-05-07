// Per-user push device registry. RLS scopes every query to (app_id, tenant_id);
// callers run inside withTenantTransaction.
//
// Token uniqueness is enforced globally (a device can only belong to one user
// at a time) — when the same handset re-registers under a different account,
// the old row is replaced.

const SCHEMA = 'platform_notifications.push_devices'

export async function upsertByToken(client, { appId, tenantId, userId, platform, token, label }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA} (app_id, tenant_id, user_id, platform, token, label, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (token) DO UPDATE
       SET app_id = EXCLUDED.app_id,
           tenant_id = EXCLUDED.tenant_id,
           user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           label = COALESCE(EXCLUDED.label, ${SCHEMA}.label),
           last_seen_at = now()
     RETURNING *`,
    [appId, tenantId, userId, platform, token, label ?? null],
  )
  return rows[0]
}

export async function listByUser(client, userId) {
  const { rows } = await client.query(
    `SELECT id, platform, token, label, last_seen_at, created_at
       FROM ${SCHEMA} WHERE user_id = $1 ORDER BY last_seen_at DESC`,
    [userId],
  )
  return rows
}

export async function tokensForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT token, platform FROM ${SCHEMA} WHERE user_id = $1`,
    [userId],
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA} WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function deleteById(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA} WHERE id = $1`,
    [id],
  )
  return rowCount > 0
}

// Used when the FCM API reports an invalid/expired token (UNREGISTERED).
// Runs without tenant context — RLS bypass via the unique token constraint.
export async function deleteByToken(client, token) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA} WHERE token = $1`,
    [token],
  )
  return rowCount > 0
}
