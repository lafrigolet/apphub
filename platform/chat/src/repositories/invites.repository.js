const SCHEMA = 'platform_chat'

const COLS = `
  id, app_id, tenant_id, conversation_id, code, created_by, role,
  max_uses, uses, expires_at, revoked_at, created_at
`

export async function insert(client, inv) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.conversation_invites
       (app_id, tenant_id, conversation_id, code, created_by, role, max_uses, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${COLS}`,
    [inv.appId, inv.tenantId, inv.conversationId, inv.code, inv.createdBy, inv.role ?? 'member', inv.maxUses ?? null, inv.expiresAt ?? null],
  )
  return rows[0]
}

export async function findByCode(client, code) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversation_invites WHERE code = $1`, [code],
  )
  return rows[0] ?? null
}

export async function listForConversation(client, conversationId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.conversation_invites
      WHERE conversation_id = $1 ORDER BY created_at DESC`,
    [conversationId],
  )
  return rows
}

export async function incrementUses(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_invites SET uses = uses + 1 WHERE id = $1 RETURNING ${COLS}`,
    [id],
  )
  return rows[0] ?? null
}

export async function revoke(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.conversation_invites SET revoked_at = now()
      WHERE id = $1 AND revoked_at IS NULL RETURNING ${COLS}`,
    [id],
  )
  return rows[0] ?? null
}
