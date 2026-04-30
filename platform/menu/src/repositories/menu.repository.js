const SCHEMA = 'platform_menu'

export async function insertMenu(client, m) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.menus (app_id, tenant_id, sub_tenant_id, name, description, is_active)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE)) RETURNING *`,
    [m.appId, m.tenantId, m.subTenantId ?? null, m.name, m.description ?? null, m.isActive ?? true],
  )
  return rows[0]
}

export async function listMenus(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.menus WHERE app_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`,
    [appId, tenantId],
  )
  return rows
}

export async function findMenuById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.menus WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function insertCategory(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.menu_categories (app_id, tenant_id, menu_id, name, course_type, display_order)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0)) RETURNING *`,
    [c.appId, c.tenantId, c.menuId, c.name, c.courseType, c.displayOrder ?? 0],
  )
  return rows[0]
}

export async function listCategoriesByMenu(client, appId, tenantId, menuId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.menu_categories WHERE app_id=$1 AND tenant_id=$2 AND menu_id=$3
     ORDER BY display_order, name`,
    [appId, tenantId, menuId],
  )
  return rows
}

export async function insertItem(client, i) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.menu_items
       (app_id, tenant_id, category_id, sku, name, description, price_cents, currency,
        course_type, station, prep_time_seconds, allergens, badges, photo_url, photo_object_id,
        is_available, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'EUR'),COALESCE($9,'main'),$10,$11,
             COALESCE($12,'{}'::text[]), COALESCE($13,'{}'::text[]),$14,$15,
             COALESCE($16,TRUE),COALESCE($17,'{}'::jsonb))
     RETURNING *`,
    [
      i.appId, i.tenantId, i.categoryId, i.sku, i.name, i.description ?? null,
      i.priceCents, i.currency ?? 'EUR', i.courseType ?? 'main', i.station ?? null,
      i.prepTimeSeconds ?? null, i.allergens ?? [], i.badges ?? [], i.photoUrl ?? null,
      i.photoObjectId ?? null,
      i.isAvailable ?? true, i.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function findItemById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.menu_items WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listItemsByCategory(client, appId, tenantId, categoryId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.menu_items WHERE app_id=$1 AND tenant_id=$2 AND category_id=$3
     ORDER BY name`,
    [appId, tenantId, categoryId],
  )
  return rows
}

export async function listAvailableItems(client, appId, tenantId, menuId) {
  const { rows } = await client.query(
    `SELECT i.* FROM ${SCHEMA}.menu_items i
     JOIN ${SCHEMA}.menu_categories c ON c.id = i.category_id
     WHERE i.app_id=$1 AND i.tenant_id=$2 AND c.menu_id=$3
       AND i.is_available = TRUE AND i.eighty_sixed = FALSE
     ORDER BY c.display_order, i.name`,
    [appId, tenantId, menuId],
  )
  return rows
}

export async function setEightySixed(client, appId, tenantId, id, value) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.menu_items SET eighty_sixed = $4, updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, value],
  )
  return rows[0] ?? null
}

export async function updateItem(client, appId, tenantId, id, patch) {
  const fields = []
  const params = [appId, tenantId, id]
  let i = 4
  const map = {
    name: 'name', description: 'description', priceCents: 'price_cents',
    isAvailable: 'is_available', allergens: 'allergens', badges: 'badges',
    photoUrl: 'photo_url', photoObjectId: 'photo_object_id',
    station: 'station', prepTimeSeconds: 'prep_time_seconds',
    courseType: 'course_type',
  }
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { fields.push(`${col} = $${i++}`); params.push(patch[k]) }
  }
  if (!fields.length) return findItemById(client, appId, tenantId, id)
  fields.push('updated_at = now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.menu_items SET ${fields.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function insertAvailabilityWindow(client, w) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.availability_windows
       (app_id, tenant_id, scope_type, scope_id, days_of_week, start_minute, end_minute, label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [w.appId, w.tenantId, w.scopeType, w.scopeId, w.daysOfWeek, w.startMinute, w.endMinute, w.label ?? null],
  )
  return rows[0]
}
