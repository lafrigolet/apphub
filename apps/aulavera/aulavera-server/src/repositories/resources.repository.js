export async function listResources(client, { type, activeOnly = true }) {
  const conds = []
  const params = []
  if (activeOnly) conds.push('active = TRUE')
  if (type) {
    params.push(type)
    conds.push(`type = $${params.length}`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const sql = `
    SELECT id, type, title, subtitle, object_id, position,
           requires_membership, active, created_at, updated_at
    FROM app_aulavera.resources
    ${where}
    ORDER BY type ASC, position ASC, title ASC
  `
  const { rows } = await client.query(sql, params)
  return rows
}
