export async function list(client) {
  const { rows } = await client.query(
    `SELECT id, key, channel, subject, body_text, body_html, variables, enabled, updated_at
       FROM platform_notifications.templates
       ORDER BY key`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT id, key, channel, subject, body_text, body_html, variables, enabled, updated_at
       FROM platform_notifications.templates WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function findByKey(client, key) {
  const { rows } = await client.query(
    `SELECT id, key, channel, subject, body_text, body_html, variables, enabled, updated_at
       FROM platform_notifications.templates WHERE key = $1 AND enabled`,
    [key],
  )
  return rows[0] ?? null
}

export async function insert(client, t) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.templates (key, channel, subject, body_text, body_html, variables, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true))
     RETURNING *`,
    [t.key, t.channel ?? 'email', t.subject ?? null, t.body_text, t.body_html ?? null, t.variables ?? [], t.enabled],
  )
  return rows[0]
}

export async function update(client, id, t) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.templates SET
       channel    = COALESCE($2, channel),
       subject    = $3,
       body_text  = COALESCE($4, body_text),
       body_html  = $5,
       variables  = COALESCE($6, variables),
       enabled    = COALESCE($7, enabled),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, t.channel, t.subject, t.body_text, t.body_html, t.variables, t.enabled],
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  await client.query(`DELETE FROM platform_notifications.templates WHERE id = $1`, [id])
}
