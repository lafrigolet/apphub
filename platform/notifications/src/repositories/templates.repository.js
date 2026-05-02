const FALLBACK_LOCALE = 'es'
const COLS = 'id, key, channel, locale, subject, body_text, body_html, variables, enabled, updated_at'

export async function list(client) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM platform_notifications.templates
       ORDER BY key, channel, locale`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM platform_notifications.templates WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

// Locale-aware lookup with fallback to FALLBACK_LOCALE ('es') when the
// requested locale has no row. Keeps existing senders working unchanged when
// no locale is passed.
export async function findByKey(client, key, channel = 'email', locale = FALLBACK_LOCALE) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM platform_notifications.templates
      WHERE key = $1 AND channel = $2 AND locale = $3 AND enabled`,
    [key, channel, locale],
  )
  if (rows[0]) return rows[0]
  if (locale === FALLBACK_LOCALE) return null
  const fb = await client.query(
    `SELECT ${COLS}
       FROM platform_notifications.templates
      WHERE key = $1 AND channel = $2 AND locale = $3 AND enabled`,
    [key, channel, FALLBACK_LOCALE],
  )
  return fb.rows[0] ?? null
}

export async function insert(client, t) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables, enabled)
     VALUES ($1, $2, COALESCE($3, 'es'), $4, $5, $6, $7, COALESCE($8, true))
     RETURNING *`,
    [t.key, t.channel ?? 'email', t.locale, t.subject ?? null, t.body_text, t.body_html ?? null, t.variables ?? [], t.enabled],
  )
  return rows[0]
}

export async function update(client, id, t) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.templates SET
       channel    = COALESCE($2, channel),
       locale     = COALESCE($3, locale),
       subject    = $4,
       body_text  = COALESCE($5, body_text),
       body_html  = $6,
       variables  = COALESCE($7, variables),
       enabled    = COALESCE($8, enabled),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, t.channel, t.locale, t.subject, t.body_text, t.body_html, t.variables, t.enabled],
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  await client.query(`DELETE FROM platform_notifications.templates WHERE id = $1`, [id])
}
