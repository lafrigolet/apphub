export async function findAll(client, { activeOnly = true } = {}) {
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, sub_tenant_id, name, description,
            price_cents, currency, category, metadata, active, created_at, updated_at
     FROM platform_catalog.items
     ${activeOnly ? 'WHERE active = true' : ''}
     ORDER BY created_at`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, sub_tenant_id, name, description,
            price_cents, currency, category, metadata, active, created_at, updated_at
     FROM platform_catalog.items WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function create(client, { appId, tenantId, subTenantId, name, description, priceCents, currency, category, metadata }) {
  const { rows } = await client.query(
    `INSERT INTO platform_catalog.items
       (app_id, tenant_id, sub_tenant_id, name, description, price_cents, currency, category, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, app_id, tenant_id, sub_tenant_id, name, description,
               price_cents, currency, category, metadata, active, created_at, updated_at`,
    [appId, tenantId, subTenantId ?? null, name, description ?? null, priceCents ?? 0, currency ?? 'eur', category ?? null, metadata ? JSON.stringify(metadata) : null],
  )
  return rows[0]
}

export async function update(client, id, { name, description, priceCents, currency, category, metadata, active }) {
  const fields = []
  const values = []
  let idx = 1

  if (name        !== undefined) { fields.push(`name = $${idx++}`);        values.push(name) }
  if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description) }
  if (priceCents  !== undefined) { fields.push(`price_cents = $${idx++}`); values.push(priceCents) }
  if (currency    !== undefined) { fields.push(`currency = $${idx++}`);    values.push(currency) }
  if (category    !== undefined) { fields.push(`category = $${idx++}`);    values.push(category) }
  if (metadata    !== undefined) { fields.push(`metadata = $${idx++}`);    values.push(JSON.stringify(metadata)) }
  if (active      !== undefined) { fields.push(`active = $${idx++}`);      values.push(active) }

  if (fields.length === 0) return findById(client, id)

  fields.push(`updated_at = now()`)
  values.push(id)

  const { rows } = await client.query(
    `UPDATE platform_catalog.items SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, app_id, tenant_id, sub_tenant_id, name, description,
               price_cents, currency, category, metadata, active, created_at, updated_at`,
    values,
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_catalog.items WHERE id = $1`,
    [id],
  )
  return rowCount > 0
}
