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
  // Unifies the two attachment sources into a single `attachments` field on each
  // message, deprecating the per-message round-trip the client used to make:
  //   - storage-backed rows from message_attachments (preferred), resolved into
  //     a normalized array `[{ id, objectId, kind, displayOrder }]`;
  //   - if none exist, fall back to the legacy messages.attachments JSONB column.
  // The legacy column is no longer the source of truth for new uploads; this is
  // the migration path before it is eventually dropped.
  const { rows } = await client.query(
    `SELECT
        m.id, m.app_id, m.tenant_id, m.thread_id, m.sender_user_id,
        m.body, m.read_at, m.created_at,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
                    'id', a.id,
                    'objectId', a.object_id,
                    'kind', a.kind,
                    'displayOrder', a.display_order)
                  ORDER BY a.display_order, a.created_at)
             FROM ${SCHEMA}.message_attachments a
            WHERE a.app_id = m.app_id AND a.tenant_id = m.tenant_id
              AND a.message_id = m.id),
          NULLIF(m.attachments, '[]'::jsonb),
          '[]'::jsonb
        ) AS attachments
       FROM ${SCHEMA}.messages m
      WHERE m.app_id=$1 AND m.tenant_id=$2 AND m.thread_id=$3
      ORDER BY m.created_at ASC
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

// Bulk "mark whole thread as read" for the reading user: only flips messages
// the user did NOT send and that are still unread (idempotent). Returns the
// number of messages newly marked, so the caller can decide whether to emit an
// event. Scoped by (app_id, tenant_id, thread_id).
export async function markThreadRead(client, appId, tenantId, threadId, readerUserId) {
  const { rowCount } = await client.query(
    `UPDATE ${SCHEMA}.messages
        SET read_at = now()
      WHERE app_id=$1 AND tenant_id=$2 AND thread_id=$3
        AND sender_user_id <> $4
        AND read_at IS NULL`,
    [appId, tenantId, threadId, readerUserId],
  )
  return rowCount
}

// Count unread messages addressed to `userId` in one thread (messages the user
// did not send and has not read). Backed by the partial unread index.
export async function countUnreadInThread(client, appId, tenantId, threadId, userId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
       FROM ${SCHEMA}.messages
      WHERE app_id=$1 AND tenant_id=$2 AND thread_id=$3
        AND sender_user_id <> $4
        AND read_at IS NULL`,
    [appId, tenantId, threadId, userId],
  )
  return rows[0].n
}

// Unread counts grouped by thread for every thread the user participates in
// (as buyer or vendor). One round-trip → powers an inbox badge without N+1.
export async function unreadCountsByThread(client, appId, tenantId, userId) {
  const { rows } = await client.query(
    `SELECT m.thread_id, count(*)::int AS unread
       FROM ${SCHEMA}.messages m
       JOIN ${SCHEMA}.threads t ON t.id = m.thread_id
        AND t.app_id = m.app_id AND t.tenant_id = m.tenant_id
      WHERE m.app_id=$1 AND m.tenant_id=$2
        AND m.read_at IS NULL
        AND m.sender_user_id <> $3
        AND (t.buyer_user_id = $3 OR t.vendor_user_id = $3)
      GROUP BY m.thread_id`,
    [appId, tenantId, userId],
  )
  return rows
}

// Record the vendor's first reply time once (keep-first via COALESCE). Returns
// true only when this call actually set the column (i.e. it was the first vendor
// reply), so the service can emit a one-shot `thread.first_reply` event.
export async function recordFirstReply(client, appId, tenantId, threadId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.threads
        SET first_reply_at = now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
        AND first_reply_at IS NULL
      RETURNING first_reply_at`,
    [appId, tenantId, threadId],
  )
  return rows.length > 0
}

// ── Storage-backed attachments ──────────────────────────────────────────

export async function findMessageById(client, appId, tenantId, messageId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.messages WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, messageId],
  )
  return rows[0] ?? null
}

export async function insertAttachment(client, appId, tenantId, messageId, { objectId, kind, displayOrder }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.message_attachments (app_id, tenant_id, message_id, object_id, kind, display_order)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0))
     RETURNING *`,
    [appId, tenantId, messageId, objectId, kind, displayOrder ?? 0],
  )
  return rows[0]
}

export async function listAttachments(client, appId, tenantId, messageId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.message_attachments
       WHERE app_id=$1 AND tenant_id=$2 AND message_id=$3
       ORDER BY display_order, created_at`,
    [appId, tenantId, messageId],
  )
  return rows
}

export async function deleteAttachment(client, appId, tenantId, attachmentId) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.message_attachments WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, attachmentId],
  )
  return rowCount > 0
}
