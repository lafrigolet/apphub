const SCHEMA = 'platform_chat'

const COLS = `id, app_id, tenant_id, title, body, created_by, created_at, updated_at`

export async function insert(client, { appId, tenantId, title, body, createdBy }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.support_macros (app_id, tenant_id, title, body, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
    [appId, tenantId, title, body, createdBy],
  )
  return rows[0]
}

export async function list(client) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.support_macros ORDER BY title`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(`SELECT ${COLS} FROM ${SCHEMA}.support_macros WHERE id = $1`, [id])
  return rows[0] ?? null
}

// Partial update of title/body. The touch_updated_at trigger refreshes
// updated_at. Returns null when the macro doesn't exist (or RLS hides it).
export async function update(client, id, { title, body }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.support_macros
        SET title = COALESCE($2, title), body = COALESCE($3, body)
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, title ?? null, body ?? null],
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  const { rowCount } = await client.query(`DELETE FROM ${SCHEMA}.support_macros WHERE id = $1`, [id])
  return rowCount > 0
}
