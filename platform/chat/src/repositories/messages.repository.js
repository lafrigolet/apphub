const SCHEMA = 'platform_chat'

const COLS = `
  id, app_id, tenant_id, conversation_id, sender_user_id, type, body,
  reply_to_message_id, thread_root_id, status, scheduled_for, cancelled_at, expires_at,
  edited_at, deleted_at, metadata, created_at
`

export async function insert(client, m) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.messages
       (app_id, tenant_id, conversation_id, sender_user_id, type, body, reply_to_message_id,
        thread_root_id, status, scheduled_for, expires_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,'sent'),$10,$11,$12)
     RETURNING ${COLS}`,
    [
      m.appId, m.tenantId, m.conversationId, m.senderUserId ?? null,
      m.type ?? 'text', m.body ?? null, m.replyToMessageId ?? null,
      m.threadRootId ?? null, m.status ?? null, m.scheduledFor ?? null, m.expiresAt ?? null,
      m.metadata ?? {},
    ],
  )
  return rows[0]
}

// A scheduled message becomes live: flip to 'sent' and re-stamp created_at so it
// sorts as a fresh message. Returns null if it was already delivered/removed.
export async function deliverScheduled(client, id, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.messages
        SET status = 'sent', created_at = $2
      WHERE id = $1 AND status = 'scheduled'
      RETURNING ${COLS}`,
    [id, when],
  )
  return rows[0] ?? null
}

// The caller's own still-pending scheduled messages, soonest-first. Optionally
// scoped to one conversation. Cancelled / already-delivered rows are excluded
// (status is only 'scheduled' while pending).
export async function listScheduledForSender(client, senderUserId, { conversationId, limit = 100 } = {}) {
  const params = [senderUserId]
  let conv = ''
  if (conversationId) { params.push(conversationId); conv = `AND conversation_id = $${params.length}` }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.messages
      WHERE sender_user_id = $1 AND status = 'scheduled' ${conv}
      ORDER BY scheduled_for ASC
      LIMIT $${params.length}`,
    params,
  )
  return rows
}

// Cancel a still-scheduled message: flip to 'cancelled' and stamp cancelled_at
// so the scheduler's partial index stops matching it. Returns null if it was
// already dispatched, cancelled, or belongs to someone else.
export async function cancelScheduled(client, id, senderUserId, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.messages
        SET status = 'cancelled', cancelled_at = $3
      WHERE id = $1 AND sender_user_id = $2 AND status = 'scheduled'
      RETURNING ${COLS}`,
    [id, senderUserId, when],
  )
  return rows[0] ?? null
}

// Move a still-scheduled message to a new future time. Returns null if it was
// already dispatched/cancelled or isn't the caller's.
export async function rescheduleScheduled(client, id, senderUserId, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.messages
        SET scheduled_for = $3
      WHERE id = $1 AND sender_user_id = $2 AND status = 'scheduled'
      RETURNING ${COLS}`,
    [id, senderUserId, when],
  )
  return rows[0] ?? null
}

export async function listThread(client, rootId, { limit = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.messages
      WHERE (id = $1 OR thread_root_id = $1) AND status = 'sent'
      ORDER BY created_at ASC LIMIT $2`,
    [rootId, limit],
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.messages WHERE id = $1`, [id],
  )
  return rows[0] ?? null
}

// Cursor pagination. Default newest-first; `after` walks forward in time.
export async function list(client, conversationId, { before, after, limit = 50 } = {}) {
  const params = [conversationId]
  let cursor = ''
  if (before) { params.push(before); cursor = `AND m.created_at < (SELECT created_at FROM ${SCHEMA}.messages WHERE id = $${params.length})` }
  if (after)  { params.push(after);  cursor = `AND m.created_at > (SELECT created_at FROM ${SCHEMA}.messages WHERE id = $${params.length})` }
  params.push(limit)
  const order = after ? 'ASC' : 'DESC'
  const { rows } = await client.query(
    `SELECT ${COLS.split(',').map((s) => `m.${s.trim()}`).join(', ')}
       FROM ${SCHEMA}.messages m
      WHERE m.conversation_id = $1 ${cursor}
        AND m.status = 'sent'
        AND m.thread_root_id IS NULL
        AND (m.expires_at IS NULL OR m.expires_at > now())
      ORDER BY m.created_at ${order}
      LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function updateBody(client, id, body, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.messages SET body = $2, edited_at = $3
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${COLS}`,
    [id, body, when],
  )
  return rows[0] ?? null
}

export async function softDelete(client, id, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.messages SET deleted_at = $2, body = NULL
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${COLS}`,
    [id, when],
  )
  return rows[0] ?? null
}

// Full-text search restricted to conversations the user actively belongs to,
// with optional filters (conversation, sender, type, date range).
export async function search(client, userId, q, { limit = 50, conversationId, senderUserId, type, before, after, language = 'simple' } = {}) {
  // language is a Postgres regconfig name; callers pass a value already
  // validated against an allow-list (SEARCH_LANGUAGES), so it is safe to inline.
  // 'simple' matches the body_tsv generated column and uses its GIN index;
  // other configs recompute to_tsvector(language, body) at query time for
  // correct stemming/stop-words.
  const lang = ['simple', 'spanish', 'english'].includes(language) ? language : 'simple'
  const matcher = lang === 'simple'
    ? `m.body_tsv @@ plainto_tsquery('simple', $2)`
    : `to_tsvector('${lang}', coalesce(m.body, '')) @@ plainto_tsquery('${lang}', $2)`
  const filters = []
  const params = [userId, q]
  if (conversationId) { params.push(conversationId); filters.push(`m.conversation_id = $${params.length}`) }
  if (senderUserId)   { params.push(senderUserId);   filters.push(`m.sender_user_id = $${params.length}`) }
  if (type)           { params.push(type);           filters.push(`m.type = $${params.length}`) }
  if (before)         { params.push(before);         filters.push(`m.created_at < $${params.length}`) }
  if (after)          { params.push(after);          filters.push(`m.created_at > $${params.length}`) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT ${COLS.split(',').map((s) => `m.${s.trim()}`).join(', ')}
       FROM ${SCHEMA}.messages m
       JOIN ${SCHEMA}.conversation_participants p
         ON p.conversation_id = m.conversation_id
        AND p.user_id = $1 AND p.left_at IS NULL
      WHERE m.deleted_at IS NULL
        AND m.status = 'sent'
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND ${matcher}
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      ORDER BY m.created_at DESC
      LIMIT $${params.length}`,
    params,
  )
  return rows
}

// Per-conversation unread counts for a user (only convos they belong to).
export async function unreadSummary(client, userId) {
  const { rows } = await client.query(
    `SELECT c.id AS conversation_id,
            (SELECT COUNT(*) FROM ${SCHEMA}.messages m
               WHERE m.conversation_id = c.id
                 AND m.deleted_at IS NULL
                 AND m.status = 'sent'
                 AND (m.expires_at IS NULL OR m.expires_at > now())
                 AND m.sender_user_id IS DISTINCT FROM p.user_id
                 AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
            )::int AS unread_count
       FROM ${SCHEMA}.conversation_participants p
       JOIN ${SCHEMA}.conversations c ON c.id = p.conversation_id
      WHERE p.user_id = $1 AND p.left_at IS NULL`,
    [userId],
  )
  return rows.filter((r) => r.unread_count > 0)
}

// GDPR right-to-be-forgotten: detach a user from their chat history. We keep
// the rows (so threads/receipts stay coherent) but null the author and wipe the
// body, then drop the user's reactions and mentions. Returns how many messages
// were anonymized. Scoped to the tenant by RLS.
export async function anonymizeUser(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE ${SCHEMA}.messages
        SET sender_user_id = NULL, body = NULL, metadata = '{}'::jsonb
      WHERE sender_user_id = $1`,
    [userId],
  )
  await client.query(`DELETE FROM ${SCHEMA}.message_reactions WHERE user_id = $1`, [userId])
  await client.query(`DELETE FROM ${SCHEMA}.message_mentions WHERE mentioned_user_id = $1`, [userId])
  return rowCount
}

// ── mentions (live with messages — they share lifecycle) ─────────────────

export async function insertMentions(client, message, userIds) {
  if (!userIds?.length) return
  const values = userIds.map((_, i) => `($1,$2,$3,$${i + 4})`).join(', ')
  await client.query(
    `INSERT INTO ${SCHEMA}.message_mentions (message_id, app_id, tenant_id, mentioned_user_id)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [message.id, message.app_id, message.tenant_id, ...userIds],
  )
}
