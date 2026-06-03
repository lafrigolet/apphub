const SCHEMA = 'platform_chat'

export async function insert(client, { appId, tenantId, conversationId, rating, comment, submittedBy }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.support_csat (app_id, tenant_id, conversation_id, rating, comment, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (conversation_id, submitted_by)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()
     RETURNING id, conversation_id, rating, comment, submitted_by, created_at`,
    [appId, tenantId, conversationId, rating, comment ?? null, submittedBy],
  )
  return rows[0]
}

export async function getForConversation(client, conversationId) {
  const { rows } = await client.query(
    `SELECT id, conversation_id, rating, comment, submitted_by, created_at
       FROM ${SCHEMA}.support_csat WHERE conversation_id = $1 ORDER BY created_at DESC`,
    [conversationId],
  )
  return rows
}
