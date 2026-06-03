const SCHEMA = 'platform_chat'

const COLS = `
  id, app_id, tenant_id, sub_tenant_id, type, title, topic, avatar_object_id,
  created_by, status, dedupe_key, is_public, is_request, requested_by, queue,
  assigned_agent_user_id, support_status, priority, subject,
  metadata, last_message_at, created_at, updated_at
`

export async function insert(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.conversations
       (app_id, tenant_id, sub_tenant_id, type, title, topic, avatar_object_id,
        created_by, dedupe_key, support_status, priority, subject,
        is_public, is_request, requested_by, queue, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       COALESCE($13,false), COALESCE($14,false),$15,$16,$17)
     RETURNING ${COLS}`,
    [
      c.appId, c.tenantId, c.subTenantId ?? null, c.type,
      c.title ?? null, c.topic ?? null, c.avatarObjectId ?? null,
      c.createdBy, c.dedupeKey ?? null,
      c.supportStatus ?? null, c.priority ?? null, c.subject ?? null,
      c.isPublic ?? null, c.isRequest ?? null, c.requestedBy ?? null, c.queue ?? null,
      c.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversations WHERE id = $1`, [id],
  )
  return rows[0] ?? null
}

export async function findByDedupe(client, dedupeKey) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversations WHERE dedupe_key = $1`, [dedupeKey],
  )
  return rows[0] ?? null
}

// Conversations the user actively participates in, with unread count.
export async function listForUser(client, userId, { type, status, limit = 50 } = {}) {
  const filters = ['p.user_id = $1', 'p.left_at IS NULL']
  const params = [userId]
  if (type)   { params.push(type);   filters.push(`c.type = $${params.length}`) }
  if (status) { params.push(status); filters.push(`c.status = $${params.length}`) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT ${COLS.split(',').map((s) => `c.${s.trim()}`).join(', ')},
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
      WHERE ${filters.join(' AND ')}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function update(client, id, fields) {
  const sets = []
  const params = [id]
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) return findById(client, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversations SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
    params,
  )
  return rows[0] ?? null
}

export async function bumpLastMessageAt(client, id, when) {
  await client.query(
    `UPDATE ${SCHEMA}.conversations SET last_message_at = $2 WHERE id = $1`,
    [id, when],
  )
}

export async function listSupportQueue(client, { status, queue, limit = 100 } = {}) {
  const filters = [`type = 'support'`]
  const params = []
  if (status) { params.push(status); filters.push(`support_status = $${params.length}`) }
  if (queue)  { params.push(queue);  filters.push(`queue = $${params.length}`) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversations
      WHERE ${filters.join(' AND ')}
      ORDER BY COALESCE(last_message_at, created_at) ASC
      LIMIT $${params.length}`,
    params,
  )
  return rows
}

// Public, discoverable groups within the tenant (for a directory).
export async function listPublic(client, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversations
      WHERE type = 'group' AND is_public AND status = 'active'
      ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT $1`,
    [limit],
  )
  return rows
}

// Aggregate counts for the admin metrics endpoint.
export async function metrics(client, sinceDays = 7) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM ${SCHEMA}.conversations WHERE type = 'direct')::int  AS direct_count,
       (SELECT COUNT(*) FROM ${SCHEMA}.conversations WHERE type = 'group')::int   AS group_count,
       (SELECT COUNT(*) FROM ${SCHEMA}.conversations WHERE type = 'support')::int AS support_count,
       (SELECT COUNT(*) FROM ${SCHEMA}.conversations WHERE type = 'support' AND support_status IN ('open','pending'))::int AS support_open,
       (SELECT COUNT(*) FROM ${SCHEMA}.messages WHERE status = 'sent' AND created_at > now() - ($1 || ' days')::interval)::int AS messages_recent,
       (SELECT COUNT(DISTINCT sender_user_id) FROM ${SCHEMA}.messages WHERE created_at > now() - ($1 || ' days')::interval)::int AS active_senders`,
    [String(sinceDays)],
  )
  return rows[0]
}

// Export all live messages of a conversation (staff audit/export).
export async function exportMessages(client, conversationId) {
  const { rows } = await client.query(
    `SELECT id, sender_user_id, type, body, reply_to_message_id, thread_root_id,
            edited_at, deleted_at, created_at
       FROM ${SCHEMA}.messages
      WHERE conversation_id = $1 AND status = 'sent'
      ORDER BY created_at ASC`,
    [conversationId],
  )
  return rows
}
