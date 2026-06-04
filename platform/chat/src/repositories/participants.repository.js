const SCHEMA = 'platform_chat'

const COLS = `
  conversation_id, user_id, app_id, tenant_id, role,
  joined_at, left_at, last_read_message_id, last_read_at,
  last_delivered_message_id, last_delivered_at, muted_until, notify_pref
`

export async function insert(client, p) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.conversation_participants
       (conversation_id, user_id, app_id, tenant_id, role)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET left_at = NULL, role = EXCLUDED.role
     RETURNING ${COLS}`,
    [p.conversationId, p.userId, p.appId, p.tenantId, p.role ?? 'member'],
  )
  return rows[0]
}

export async function find(client, conversationId, userId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  )
  return rows[0] ?? null
}

export async function list(client, conversationId, { includeLeft = false } = {}) {
  const where = includeLeft ? '' : 'AND left_at IS NULL'
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversation_participants
       WHERE conversation_id = $1 ${where}
       ORDER BY joined_at ASC`,
    [conversationId],
  )
  return rows
}

export async function countActive(client, conversationId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${SCHEMA}.conversation_participants
       WHERE conversation_id = $1 AND left_at IS NULL`,
    [conversationId],
  )
  return rows[0].n
}

export async function update(client, conversationId, userId, fields) {
  const sets = []
  const params = [conversationId, userId]
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) return find(client, conversationId, userId)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_participants SET ${sets.join(', ')}
       WHERE conversation_id = $1 AND user_id = $2 RETURNING ${COLS}`,
    params,
  )
  return rows[0] ?? null
}

export async function leave(client, conversationId, userId, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_participants SET left_at = $3
       WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
       RETURNING ${COLS}`,
    [conversationId, userId, when],
  )
  return rows[0] ?? null
}

// GDPR erase: mark the user as having left every conversation they were in.
// Returns the distinct conversation ids touched so the caller can fan out.
export async function leaveAllForUser(client, userId, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_participants SET left_at = $2
       WHERE user_id = $1 AND left_at IS NULL
       RETURNING conversation_id`,
    [userId, when],
  )
  return rows.map((r) => r.conversation_id)
}

// Distinct user ids that share at least one active conversation with `userId`
// (excluding the user themself). Used to broadcast presence transitions.
export async function coParticipantUserIds(client, userId) {
  const { rows } = await client.query(
    `SELECT DISTINCT other.user_id
       FROM ${SCHEMA}.conversation_participants mine
       JOIN ${SCHEMA}.conversation_participants other
         ON other.conversation_id = mine.conversation_id
        AND other.left_at IS NULL
        AND other.user_id <> mine.user_id
      WHERE mine.user_id = $1 AND mine.left_at IS NULL`,
    [userId],
  )
  return rows.map((r) => r.user_id)
}

export async function setLastRead(client, conversationId, userId, messageId, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_participants
        SET last_read_message_id = $3, last_read_at = $4
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING ${COLS}`,
    [conversationId, userId, messageId, when],
  )
  return rows[0] ?? null
}

export async function setDelivered(client, conversationId, userId, messageId, when) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_participants
        SET last_delivered_message_id = $3, last_delivered_at = $4
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING ${COLS}`,
    [conversationId, userId, messageId, when],
  )
  return rows[0] ?? null
}
