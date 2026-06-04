// Projection shared by every item read. Kept as one constant so every query
// returns the same shape (incl. SEO + type + soft-delete columns).
const ITEM_COLS = `id, app_id, tenant_id, sub_tenant_id, name, description,
            price_cents, currency, category, metadata, active, status, version_number,
            published_at, slug, meta_title, meta_description, item_type, deleted_at,
            created_at, updated_at`

export async function findAll(client, { activeOnly = true, includeDeleted = false, limit = null, offset = 0 } = {}) {
  const where = []
  if (activeOnly) where.push('active = true')
  if (!includeDeleted) where.push('deleted_at IS NULL')
  const params = []
  let limitClause = ''
  if (limit != null) {
    params.push(limit, offset)
    limitClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`
  }
  const { rows } = await client.query(
    `SELECT ${ITEM_COLS}
     FROM platform_catalog.items
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at
     ${limitClause}`,
    params,
  )
  return rows
}

// Count of items matching the same scope as findAll — used for pagination meta.
export async function countAll(client, { activeOnly = true, includeDeleted = false } = {}) {
  const where = []
  if (activeOnly) where.push('active = true')
  if (!includeDeleted) where.push('deleted_at IS NULL')
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total FROM platform_catalog.items
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
  )
  return rows[0].total
}

// Búsqueda por texto sobre nombre/descripción. ILIKE (case-insensitive) —
// portable sin extensiones; cuando se cablee pg_trgm para fuzziness basta
// cambiar el operador aquí. El término se parametriza (anti-injection) y se
// envuelve en comodines.
export async function searchItems(client, { q, activeOnly = true, includeDeleted = false, limit = null, offset = 0 } = {}) {
  const term = `%${q ?? ''}%`
  const params = [term]
  const where = ['(name ILIKE $1 OR description ILIKE $1)']
  if (activeOnly) where.push('active = true')
  if (!includeDeleted) where.push('deleted_at IS NULL')
  let limitClause = ''
  if (limit != null) {
    params.push(limit, offset)
    limitClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`
  }
  const { rows } = await client.query(
    `SELECT ${ITEM_COLS}
     FROM platform_catalog.items
     WHERE ${where.join(' AND ')}
     ORDER BY created_at
     ${limitClause}`,
    params,
  )
  return rows
}

export async function countSearch(client, { q, activeOnly = true, includeDeleted = false } = {}) {
  const term = `%${q ?? ''}%`
  const where = ['(name ILIKE $1 OR description ILIKE $1)']
  if (activeOnly) where.push('active = true')
  if (!includeDeleted) where.push('deleted_at IS NULL')
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total FROM platform_catalog.items WHERE ${where.join(' AND ')}`,
    [term],
  )
  return rows[0].total
}

export async function findById(client, id, { includeDeleted = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${ITEM_COLS}
     FROM platform_catalog.items
     WHERE id = $1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  )
  return rows[0] ?? null
}

export async function create(client, { appId, tenantId, subTenantId, name, description, priceCents, currency, category, metadata, slug, metaTitle, metaDescription, itemType }) {
  const { rows } = await client.query(
    `INSERT INTO platform_catalog.items
       (app_id, tenant_id, sub_tenant_id, name, description, price_cents, currency, category, metadata,
        slug, meta_title, meta_description, item_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, 'physical'))
     RETURNING ${ITEM_COLS}`,
    [appId, tenantId, subTenantId ?? null, name, description ?? null, priceCents ?? 0, currency ?? 'eur',
     category ?? null, metadata ? JSON.stringify(metadata) : null,
     slug ?? null, metaTitle ?? null, metaDescription ?? null, itemType ?? null],
  )
  return rows[0]
}

export async function update(client, id, { name, description, priceCents, currency, category, metadata, active, slug, metaTitle, metaDescription, itemType }) {
  const fields = []
  const values = []
  let idx = 1

  if (name            !== undefined) { fields.push(`name = $${idx++}`);             values.push(name) }
  if (description     !== undefined) { fields.push(`description = $${idx++}`);      values.push(description) }
  if (priceCents      !== undefined) { fields.push(`price_cents = $${idx++}`);      values.push(priceCents) }
  if (currency        !== undefined) { fields.push(`currency = $${idx++}`);         values.push(currency) }
  if (category        !== undefined) { fields.push(`category = $${idx++}`);         values.push(category) }
  if (metadata        !== undefined) { fields.push(`metadata = $${idx++}`);         values.push(JSON.stringify(metadata)) }
  if (active          !== undefined) { fields.push(`active = $${idx++}`);           values.push(active) }
  if (slug            !== undefined) { fields.push(`slug = $${idx++}`);             values.push(slug) }
  if (metaTitle       !== undefined) { fields.push(`meta_title = $${idx++}`);       values.push(metaTitle) }
  if (metaDescription !== undefined) { fields.push(`meta_description = $${idx++}`); values.push(metaDescription) }
  if (itemType        !== undefined) { fields.push(`item_type = $${idx++}`);        values.push(itemType) }

  if (fields.length === 0) return findById(client, id)

  fields.push(`updated_at = now()`)
  values.push(id)

  const { rows } = await client.query(
    `UPDATE platform_catalog.items SET ${fields.join(', ')}
     WHERE id = $${idx} AND deleted_at IS NULL
     RETURNING ${ITEM_COLS}`,
    values,
  )
  return rows[0] ?? null
}

// Hard delete — kept for callers/CSV that truly want the row gone.
export async function remove(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_catalog.items WHERE id = $1`,
    [id],
  )
  return rowCount > 0
}

// Soft delete: stamps deleted_at, leaving the row for historic order references.
export async function softDelete(client, id) {
  const { rows } = await client.query(
    `UPDATE platform_catalog.items
        SET deleted_at = now(), active = false, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${ITEM_COLS}`,
    [id],
  )
  return rows[0] ?? null
}

export async function restore(client, id) {
  const { rows } = await client.query(
    `UPDATE platform_catalog.items
        SET deleted_at = NULL, updated_at = now()
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING ${ITEM_COLS}`,
    [id],
  )
  return rows[0] ?? null
}

// ── Versioning ─────────────────────────────────────────────────────────

export async function setStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE platform_catalog.items
        SET status = $2,
            published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
            updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${ITEM_COLS}`,
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

// ── Categories (tree) ──────────────────────────────────────────────────

export async function listCategories(client) {
  const { rows } = await client.query(
    `SELECT id, parent_id, name, slug, description, display_order, created_at, updated_at
       FROM platform_catalog.categories
       ORDER BY display_order, name`,
  )
  return rows
}

export async function findCategoryById(client, id) {
  const { rows } = await client.query(
    `SELECT id, parent_id, name, slug, description, display_order, created_at, updated_at
       FROM platform_catalog.categories WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function createCategory(client, { appId, tenantId, subTenantId, parentId, name, slug, description, displayOrder }) {
  const { rows } = await client.query(
    `INSERT INTO platform_catalog.categories
        (app_id, tenant_id, sub_tenant_id, parent_id, name, slug, description, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0))
     RETURNING id, parent_id, name, slug, description, display_order, created_at, updated_at`,
    [appId, tenantId, subTenantId ?? null, parentId ?? null, name, slug, description ?? null, displayOrder ?? null],
  )
  return rows[0]
}

export async function updateCategory(client, id, { parentId, name, slug, description, displayOrder }) {
  const fields = []
  const values = []
  let idx = 1
  if (parentId     !== undefined) { fields.push(`parent_id = $${idx++}`);     values.push(parentId) }
  if (name         !== undefined) { fields.push(`name = $${idx++}`);          values.push(name) }
  if (slug         !== undefined) { fields.push(`slug = $${idx++}`);          values.push(slug) }
  if (description  !== undefined) { fields.push(`description = $${idx++}`);    values.push(description) }
  if (displayOrder !== undefined) { fields.push(`display_order = $${idx++}`); values.push(displayOrder) }
  if (fields.length === 0) return findCategoryById(client, id)
  fields.push(`updated_at = now()`)
  values.push(id)
  const { rows } = await client.query(
    `UPDATE platform_catalog.categories SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, parent_id, name, slug, description, display_order, created_at, updated_at`,
    values,
  )
  return rows[0] ?? null
}

export async function deleteCategory(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_catalog.categories WHERE id = $1`,
    [id],
  )
  return rowCount > 0
}

// ── M:N item ↔ category ────────────────────────────────────────────────

export async function listItemCategories(client, itemId) {
  const { rows } = await client.query(
    `SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.display_order
       FROM platform_catalog.item_categories ic
       JOIN platform_catalog.categories c ON c.id = ic.category_id
      WHERE ic.item_id = $1
      ORDER BY c.display_order, c.name`,
    [itemId],
  )
  return rows
}

export async function assignCategory(client, { appId, tenantId, itemId, categoryId }) {
  await client.query(
    `INSERT INTO platform_catalog.item_categories (app_id, tenant_id, item_id, category_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, category_id) DO NOTHING`,
    [appId, tenantId, itemId, categoryId],
  )
}

export async function unassignCategory(client, { itemId, categoryId }) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_catalog.item_categories WHERE item_id = $1 AND category_id = $2`,
    [itemId, categoryId],
  )
  return rowCount > 0
}

export async function listItemsByCategory(client, categoryId, { activeOnly = true } = {}) {
  const { rows } = await client.query(
    `SELECT ${ITEM_COLS}
       FROM platform_catalog.items i
       JOIN platform_catalog.item_categories ic ON ic.item_id = i.id
      WHERE ic.category_id = $1
        AND i.deleted_at IS NULL
        ${activeOnly ? 'AND i.active = true' : ''}
      ORDER BY i.created_at`,
    [categoryId],
  )
  return rows
}
