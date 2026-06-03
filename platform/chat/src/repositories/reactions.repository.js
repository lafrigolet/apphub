const SCHEMA = 'platform_chat'

export async function add(client, { messageId, userId, emoji, appId, tenantId }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.message_reactions (message_id, user_id, emoji, app_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING
     RETURNING message_id, user_id, emoji, created_at`,
    [messageId, userId, emoji, appId, tenantId],
  )
  return rows[0] ?? null
}

export async function remove(client, messageId, userId, emoji) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [messageId, userId, emoji],
  )
  return rowCount > 0
}

export async function listForMessage(client, messageId) {
  const { rows } = await client.query(
    `SELECT emoji, COUNT(*)::int AS count, array_agg(user_id) AS user_ids
       FROM ${SCHEMA}.message_reactions
      WHERE message_id = $1
      GROUP BY emoji
      ORDER BY emoji`,
    [messageId],
  )
  return rows
}
