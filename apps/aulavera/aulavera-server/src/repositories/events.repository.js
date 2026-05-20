// Repositorio de eventos (workshops + chronicles). Todas las queries
// transcurren dentro de withTenantTransaction → `app.app_id` y
// `app.tenant_id` se inyectan como GUC y RLS filtra por tenant.

export async function listEvents(client, { kind, status = 'active' }) {
  const conds = ['status = $1']
  const params = [status]
  if (kind) {
    params.push(kind)
    conds.push(`kind = $${params.length}`)
  }
  const sql = `
    SELECT id, kind, slug, title, when_text, area, body, quote, image_key,
           price_label, tags, position, status, published_at,
           created_at, updated_at
    FROM app_aulavera.events
    WHERE ${conds.join(' AND ')}
    ORDER BY position ASC, published_at DESC
  `
  const { rows } = await client.query(sql, params)
  return rows
}

export async function findEventById(client, id) {
  const { rows } = await client.query(
    `SELECT id, kind, slug, title, when_text, area, body, quote, image_key,
            price_label, tags, position, status, published_at,
            created_at, updated_at
       FROM app_aulavera.events
      WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}
