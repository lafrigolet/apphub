const SCHEMA = 'platform_chat'

export async function add(client, { conversationId, messageId, appId, tenantId, pinnedBy }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.pinned_messages (conversation_id, message_id, app_id, tenant_id, pinned_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (conversation_id, message_id) DO NOTHING
     RETURNING conversation_id, message_id, pinned_by, pinned_at`,
    [conversationId, messageId, appId, tenantId, pinnedBy],
  )
  return rows[0] ?? null
}

export async function remove(client, conversationId, messageId) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.pinned_messages WHERE conversation_id = $1 AND message_id = $2`,
    [conversationId, messageId],
  )
  return rowCount > 0
}

export async function listForConversation(client, conversationId) {
  const { rows } = await client.query(
    `SELECT p.conversation_id, p.message_id, p.pinned_by, p.pinned_at,
            m.body, m.sender_user_id, m.created_at AS message_created_at
       FROM ${SCHEMA}.pinned_messages p
       JOIN ${SCHEMA}.messages m ON m.id = p.message_id
      WHERE p.conversation_id = $1
      ORDER BY p.pinned_at DESC`,
    [conversationId],
  )
  return rows
}
