const SCHEMA = 'platform_inventory'

// Computed available stock, surfaced alongside the raw columns so callers
// don't have to recompute qty_on_hand - qty_reserved themselves.
const SELECT_ITEM = `*, (qty_on_hand - qty_reserved) AS qty_available`

export async function findBySku(client, appId, tenantId, sku) {
  const { rows } = await client.query(
    `SELECT ${SELECT_ITEM} FROM ${SCHEMA}.inventory_items
     WHERE app_id = $1 AND tenant_id = $2 AND sku = $3`,
    [appId, tenantId, sku],
  )
  return rows[0] ?? null
}

export async function listByTenant(
  client, appId, tenantId,
  { limit = 100, offset = 0, lowStock = false, parentSku, rootOnly = false, search } = {},
) {
  const params = [appId, tenantId]
  const where  = ['app_id = $1', 'tenant_id = $2']

  if (lowStock) {
    // qty_available at or below the per-SKU reorder threshold
    where.push('(qty_on_hand - qty_reserved) <= low_stock_threshold')
  }
  if (parentSku !== undefined) {
    if (parentSku === null) {
      where.push('parent_sku IS NULL')
    } else {
      params.push(parentSku)
      where.push(`parent_sku = $${params.length}`)
    }
  } else if (rootOnly) {
    where.push('parent_sku IS NULL')
  }
  if (search) {
    params.push(`%${search}%`)
    const idx = params.length
    where.push(`(sku ILIKE $${idx} OR display_name ILIKE $${idx})`)
  }

  params.push(limit)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const { rows } = await client.query(
    `SELECT ${SELECT_ITEM} FROM ${SCHEMA}.inventory_items
     WHERE ${where.join(' AND ')}
     ORDER BY sku
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  )
  return rows
}

export async function upsert(client, { appId, tenantId, sku, qtyOnHand, lowStockThreshold, parentSku, optionValues, displayName }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.inventory_items
       (app_id, tenant_id, sku, qty_on_hand, low_stock_threshold, parent_sku, option_values, display_name)
     VALUES ($1, $2, $3, $4, COALESCE($5, 0), $6, COALESCE($7::jsonb, '{}'::jsonb), $8)
     ON CONFLICT (app_id, tenant_id, sku) DO UPDATE
       SET qty_on_hand         = EXCLUDED.qty_on_hand,
           low_stock_threshold = COALESCE(EXCLUDED.low_stock_threshold, ${SCHEMA}.inventory_items.low_stock_threshold),
           parent_sku          = COALESCE(EXCLUDED.parent_sku,          ${SCHEMA}.inventory_items.parent_sku),
           option_values       = COALESCE(EXCLUDED.option_values,       ${SCHEMA}.inventory_items.option_values),
           display_name        = COALESCE(EXCLUDED.display_name,        ${SCHEMA}.inventory_items.display_name),
           updated_at          = now()
     RETURNING *`,
    [
      appId, tenantId, sku, qtyOnHand, lowStockThreshold,
      parentSku ?? null,
      optionValues != null ? JSON.stringify(optionValues) : null,
      displayName ?? null,
    ],
  )
  return rows[0]
}

// ── Variants ────────────────────────────────────────────────────────────

export async function listVariants(client, appId, tenantId, parentSku) {
  const { rows } = await client.query(
    `SELECT ${SELECT_ITEM} FROM ${SCHEMA}.inventory_items
       WHERE app_id=$1 AND tenant_id=$2 AND parent_sku=$3
       ORDER BY sku`,
    [appId, tenantId, parentSku],
  )
  return rows
}

export async function findByParentAndOptions(client, appId, tenantId, parentSku, optionValues) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.inventory_items
       WHERE app_id=$1 AND tenant_id=$2 AND parent_sku=$3
         AND option_values::text = $4::text
       LIMIT 1`,
    [appId, tenantId, parentSku, JSON.stringify(optionValues ?? {})],
  )
  return rows[0] ?? null
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

// ── Movement ledger queries ──────────────────────────────────────────────

export async function listMovements(
  client, appId, tenantId, sku,
  { reason, refType, refId, from, to, limit = 100, offset = 0 } = {},
) {
  const params = [appId, tenantId, sku]
  const where  = ['app_id = $1', 'tenant_id = $2', 'sku = $3']

  if (reason)  { params.push(reason);  where.push(`reason = $${params.length}`) }
  if (refType) { params.push(refType); where.push(`ref_type = $${params.length}`) }
  if (refId)   { params.push(refId);   where.push(`ref_id = $${params.length}`) }
  if (from)    { params.push(from);    where.push(`created_at >= $${params.length}`) }
  if (to)      { params.push(to);      where.push(`created_at <= $${params.length}`) }

  params.push(limit)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.stock_movements
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  )
  return rows
}
