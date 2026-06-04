// notification_preferences + unsubscribe_tokens repositories.
//
// Preferences use an opt-out model: a row exists only when the user actively
// muted a (category, channel). Absence ⇒ send. `channel = '*'` mutes the whole
// category across every channel.

const PREFS = 'platform_notifications.notification_preferences'
const TOKENS = 'platform_notifications.unsubscribe_tokens'

// All muted rows for a user (read inside withTenantTransaction → RLS scoped).
export async function listForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT category, channel, muted, updated_at
       FROM ${PREFS}
      WHERE user_id = $1
      ORDER BY category, channel`,
    [userId],
  )
  return rows
}

// Is a (category, channel) muted for this user? True when a wildcard ('*') or
// channel-specific muted row exists. Runs RLS-scoped.
export async function isMutedFor(client, { userId, category, channel }) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${PREFS}
      WHERE user_id = $1 AND category = $2
        AND channel IN ('*', $3) AND muted = true
      LIMIT 1`,
    [userId, category, channel],
  )
  return rows.length > 0
}

// Upsert a single preference. muted=false removes the mute (delete row) to keep
// the opt-out semantics clean (absence == send).
export async function setPreference(client, { appId, tenantId, userId, category, channel, muted }) {
  if (!muted) {
    await client.query(
      `DELETE FROM ${PREFS}
        WHERE app_id = $1 AND tenant_id = $2 AND user_id = $3
          AND category = $4 AND channel = $5`,
      [appId, tenantId, userId, category, channel],
    )
    return { category, channel, muted: false }
  }
  const { rows } = await client.query(
    `INSERT INTO ${PREFS} (app_id, tenant_id, user_id, category, channel, muted, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, now())
     ON CONFLICT (app_id, tenant_id, user_id, category, channel)
       DO UPDATE SET muted = true, updated_at = now()
     RETURNING category, channel, muted, updated_at`,
    [appId, tenantId, userId, category, channel],
  )
  return rows[0]
}

// ── unsubscribe tokens ───────────────────────────────────────────────────

export async function upsertToken(client, { appId, tenantId, userId, token }) {
  const { rows } = await client.query(
    `INSERT INTO ${TOKENS} (token, app_id, tenant_id, user_id)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id, tenant_id, user_id)
       DO UPDATE SET token = ${TOKENS}.token
     RETURNING token`,
    [token, appId, tenantId, userId],
  )
  return rows[0].token
}

// Read by token — no tenant context (public unsubscribe path). The unique,
// unguessable token is the only credential.
export async function findByToken(client, token) {
  const { rows } = await client.query(
    `SELECT token, app_id, tenant_id, user_id FROM ${TOKENS} WHERE token = $1`,
    [token],
  )
  return rows[0] ?? null
}

// Mute a category for the token's user without a tenant transaction (public
// path runs without RLS context). We pass the scope explicitly from the token
// row so isolation is preserved.
export async function muteByScope(client, { appId, tenantId, userId, category, channel }) {
  await client.query(
    `INSERT INTO ${PREFS} (app_id, tenant_id, user_id, category, channel, muted, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, now())
     ON CONFLICT (app_id, tenant_id, user_id, category, channel)
       DO UPDATE SET muted = true, updated_at = now()`,
    [appId, tenantId, userId, category, channel],
  )
}
