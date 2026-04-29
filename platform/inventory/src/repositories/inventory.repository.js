const SCHEMA = 'platform_inventory'

export async function findBySku(client, appId, tenantId, sku) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.inventory_items
     WHERE app_id = $1 AND tenant_id = $2 AND sku = $3`,
    [appId, tenantId, sku],
  )
  return rows[0] ?? null
}

export async function listByTenant(client, appId, tenantId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.inventory_items
     WHERE app_id = $1 AND tenant_id = $2
     ORDER BY sku
     LIMIT $3 OFFSET $4`,
    [appId, tenantId, limit, offset],
  )
  return rows
}

export async function upsert(client, { appId, tenantId, sku, qtyOnHand, lowStockThreshold }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.inventory_items
       (app_id, tenant_id, sku, qty_on_hand, low_stock_threshold)
     VALUES ($1, $2, $3, $4, COALESCE($5, 0))
     ON CONFLICT (app_id, tenant_id, sku) DO UPDATE
       SET qty_on_hand        = EXCLUDED.qty_on_hand,
           low_stock_threshold = COALESCE(EXCLUDED.low_stock_threshold, ${SCHEMA}.inventory_items.low_stock_threshold),
           updated_at          = now()
     RETURNING *`,
    [appId, tenantId, sku, qtyOnHand, lowStockThreshold],
  )
  return rows[0]
}

export async function adjustOnHand(client, appId, tenantId, sku, delta) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inventory_items
     SET qty_on_hand = qty_on_hand + $4,
         updated_at  = now()
     WHERE app_id = $1 AND tenant_id = $2 AND sku = $3
     RETURNING *`,
    [appId, tenantId, sku, delta],
  )
  return rows[0] ?? null
}

export async function reserve(client, appId, tenantId, sku, qty) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inventory_items
     SET qty_reserved = qty_reserved + $4,
         updated_at   = now()
     WHERE app_id = $1 AND tenant_id = $2 AND sku = $3
       AND qty_on_hand - qty_reserved >= $4
     RETURNING *`,
    [appId, tenantId, sku, qty],
  )
  return rows[0] ?? null
}

export async function release(client, appId, tenantId, sku, qty) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inventory_items
     SET qty_reserved = GREATEST(qty_reserved - $4, 0),
         updated_at   = now()
     WHERE app_id = $1 AND tenant_id = $2 AND sku = $3
     RETURNING *`,
    [appId, tenantId, sku, qty],
  )
  return rows[0] ?? null
}

export async function commit(client, appId, tenantId, sku, qty) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inventory_items
     SET qty_on_hand  = qty_on_hand  - $4,
         qty_reserved = GREATEST(qty_reserved - $4, 0),
         updated_at   = now()
     WHERE app_id = $1 AND tenant_id = $2 AND sku = $3
       AND qty_on_hand >= $4
     RETURNING *`,
    [appId, tenantId, sku, qty],
  )
  return rows[0] ?? null
}

export async function recordMovement(client, { appId, tenantId, sku, delta, reason, refType, refId, actorUserId }) {
  await client.query(
    `INSERT INTO ${SCHEMA}.stock_movements
       (app_id, tenant_id, sku, delta, reason, ref_type, ref_id, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [appId, tenantId, sku, delta, reason, refType ?? null, refId ?? null, actorUserId ?? null],
  )
}
