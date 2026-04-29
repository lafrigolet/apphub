const SCHEMA = 'platform_messaging'

export async function insertThread(client, appId, tenantId, t) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.threads
       (app_id, tenant_id, buyer_user_id, vendor_user_id, order_id, subject, status)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, 'open'))
     RETURNING *`,
    [appId, tenantId, t.buyerUserId, t.vendorUserId, t.orderId ?? null, t.subject ?? null, t.status ?? null],
  )
  return rows[0]
}

export async function findThreadById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.threads WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listThreadsForUser(client, appId, tenantId, userId, role) {
  const col = role === 'vendor' ? 'vendor_user_id' : 'buyer_user_id'
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.threads
     WHERE app_id=$1 AND tenant_id=$2 AND ${col}=$3
     ORDER BY COALESCE(last_message_at, created_at) DESC
     LIMIT 100`,
    [appId, tenantId, userId],
  )
  return rows
}

export async function insertMessage(client, appId, tenantId, threadId, senderUserId, body, attachments = []) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.messages (app_id, tenant_id, thread_id, sender_user_id, body, attachments)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [appId, tenantId, threadId, senderUserId, body, JSON.stringify(attachments)],
  )
  await client.query(
    `UPDATE ${SCHEMA}.threads SET last_message_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, threadId],
  )
  return rows[0]
}

export async function listMessages(client, appId, tenantId, threadId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.messages
     WHERE app_id=$1 AND tenant_id=$2 AND thread_id=$3
     ORDER BY created_at ASC
     LIMIT $4 OFFSET $5`,
    [appId, tenantId, threadId, limit, offset],
  )
  return rows
}

export async function markRead(client, appId, tenantId, messageId) {
  const { rowCount } = await client.query(
    `UPDATE ${SCHEMA}.messages SET read_at = COALESCE(read_at, now())
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, messageId],
  )
  return rowCount > 0
}
