const SCHEMA = 'platform_chat'

export async function insert(client, { appId, tenantId, messageId, objectId, kind, displayOrder }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.message_attachments
       (app_id, tenant_id, message_id, object_id, kind, display_order)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, 0))
     RETURNING *`,
    [appId, tenantId, messageId, objectId, kind, displayOrder ?? 0],
  )
  return rows[0]
}

export async function listForMessage(client, messageId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.message_attachments
       WHERE message_id = $1
       ORDER BY display_order, created_at`,
    [messageId],
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.message_attachments WHERE id = $1`, [id],
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.message_attachments WHERE id = $1`, [id],
  )
  return rowCount > 0
}
