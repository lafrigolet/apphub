const SCHEMA = 'platform_chat'

export async function add(client, { appId, tenantId, userId, blockedUserId }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.blocks (app_id, tenant_id, user_id, blocked_user_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (app_id, tenant_id, user_id, blocked_user_id) DO NOTHING
     RETURNING user_id, blocked_user_id, created_at`,
    [appId, tenantId, userId, blockedUserId],
  )
  return rows[0] ?? null
}

export async function remove(client, { appId, tenantId, userId, blockedUserId }) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.blocks
       WHERE app_id = $1 AND tenant_id = $2 AND user_id = $3 AND blocked_user_id = $4`,
    [appId, tenantId, userId, blockedUserId],
  )
  return rowCount > 0
}

export async function listForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT blocked_user_id, created_at FROM ${SCHEMA}.blocks WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  )
  return rows
}

// True if a blocks b OR b blocks a (block is symmetric for messaging purposes).
export async function existsBetween(client, userA, userB) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${SCHEMA}.blocks
      WHERE (user_id = $1 AND blocked_user_id = $2)
         OR (user_id = $2 AND blocked_user_id = $1)
      LIMIT 1`,
    [userA, userB],
  )
  return rows.length > 0
}
