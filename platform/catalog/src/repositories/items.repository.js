export async function findAll(client, { activeOnly = true } = {}) {
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, sub_tenant_id, name, description,
            price_cents, currency, category, metadata, active, status, version_number, published_at, created_at, updated_at
     FROM platform_catalog.items
     ${activeOnly ? 'WHERE active = true' : ''}
     ORDER BY created_at`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, sub_tenant_id, name, description,
            price_cents, currency, category, metadata, active, status, version_number, published_at, created_at, updated_at
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

// ── Versioning ─────────────────────────────────────────────────────────

export async function setStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE platform_catalog.items
        SET status = $2,
            published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING id, app_id, tenant_id, sub_tenant_id, name, description,
                price_cents, currency, category, metadata, active, status, version_number, published_at, created_at, updated_at`,
    [id, status],
  )
  return rows[0] ?? null
}

export async function publishVersion(client, itemId, versionNumber, snapshot, actorUserId) {
  await client.query(
    `INSERT INTO platform_catalog.item_versions (app_id, tenant_id, item_id, version_number, snapshot, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (item_id, version_number) DO NOTHING`,
    [snapshot.app_id, snapshot.tenant_id, itemId, versionNumber, JSON.stringify(snapshot), actorUserId ?? null],
  )
  await client.query(
    `UPDATE platform_catalog.items SET version_number = $2 WHERE id = $1`,
    [itemId, versionNumber],
  )
}

export async function listVersions(client, itemId) {
  const { rows } = await client.query(
    `SELECT id, version_number, snapshot, published_at, actor_user_id
       FROM platform_catalog.item_versions
       WHERE item_id = $1
       ORDER BY version_number DESC`,
    [itemId],
  )
  return rows
}

// ── Image gallery ──────────────────────────────────────────────────────

export async function listImages(client, itemId) {
  const { rows } = await client.query(
    `SELECT id, item_id, object_id, alt_text, display_order, created_at
       FROM platform_catalog.item_images
       WHERE item_id = $1
       ORDER BY display_order, created_at`,
    [itemId],
  )
  return rows
}

export async function insertImage(client, { itemId, objectId, altText, displayOrder }) {
  const { rows } = await client.query(
    `INSERT INTO platform_catalog.item_images
        (app_id, tenant_id, item_id, object_id, alt_text, display_order)
     SELECT i.app_id, i.tenant_id, i.id, $2, $3, COALESCE($4, 0)
       FROM platform_catalog.items i WHERE i.id = $1
     RETURNING id, item_id, object_id, alt_text, display_order, created_at`,
    [itemId, objectId, altText ?? null, displayOrder ?? 0],
  )
  return rows[0] ?? null
}

export async function deleteImage(client, imageId) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_catalog.item_images WHERE id = $1`,
    [imageId],
  )
  return rowCount > 0
}
