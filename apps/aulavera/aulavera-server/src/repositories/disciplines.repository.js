export async function listDisciplines(client, { activeOnly = true }) {
  const conds = []
  if (activeOnly) conds.push('active = TRUE')
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const sql = `
    SELECT id, slug, name, body, icon, state, position, active,
           created_at, updated_at
    FROM app_aulavera.disciplines
    ${where}
    ORDER BY position ASC, name ASC
  `
  const { rows } = await client.query(sql)
  return rows
}
