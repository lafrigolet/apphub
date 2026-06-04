const SCHEMA = 'platform_chat'

export async function add(client, { appId, tenantId, userId, bannedBy, reason, bannedUntil }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.tenant_bans (app_id, tenant_id, user_id, banned_by, reason, banned_until)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (app_id, tenant_id, user_id)
       DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason,
                     banned_until = EXCLUDED.banned_until, created_at = now()
     RETURNING user_id, banned_by, reason, banned_until, created_at`,
    [appId, tenantId, userId, bannedBy, reason ?? null, bannedUntil ?? null],
  )
  return rows[0]
}

export async function remove(client, { appId, tenantId, userId }) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.tenant_bans WHERE app_id = $1 AND tenant_id = $2 AND user_id = $3`,
    [appId, tenantId, userId],
  )
  return rowCount > 0
}

export async function list(client) {
  const { rows } = await client.query(
    `SELECT user_id, banned_by, reason, banned_until, created_at FROM ${SCHEMA}.tenant_bans ORDER BY created_at DESC`,
  )
  return rows
}

// A user is banned only while an indefinite ban exists, or a timed ban whose
// banned_until is still in the future. Lapsed temporary bans no longer apply.
export async function isBanned(client, userId) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${SCHEMA}.tenant_bans
       WHERE user_id = $1 AND (banned_until IS NULL OR banned_until > now()) LIMIT 1`, [userId],
  )
  return rows.length > 0
}
