// inbound_reply_tokens — opaque plus-address tokens (reply+<token>@domain)
// minted when an outbound email wants its replies re-ingested into a platform
// conversation. Tokens are not single-use (a thread may produce many replies);
// used_count is bookkeeping, expiry is the real bound.

export async function insert(client, t) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.inbound_reply_tokens
       (token, target_event, context, app_id, tenant_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      t.token, t.targetEvent, JSON.stringify(t.context ?? {}),
      t.appId ?? null, t.tenantId ?? null, t.expiresAt ?? null,
    ],
  )
  return rows[0]
}

export async function findValid(client, token) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_reply_tokens
     WHERE token = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [token],
  )
  return rows[0] ?? null
}

export async function recordUse(client, token) {
  await client.query(
    `UPDATE platform_notifications.inbound_reply_tokens
     SET used_count = used_count + 1
     WHERE token = $1`,
    [token],
  )
}

// Expired tokens are dead weight — purged alongside inbound retention.
export async function purgeExpired(client) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_notifications.inbound_reply_tokens
     WHERE expires_at IS NOT NULL AND expires_at < now()`,
  )
  return rowCount
}
