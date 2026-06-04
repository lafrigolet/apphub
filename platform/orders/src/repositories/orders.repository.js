const SCHEMA = 'platform_orders'

export async function insertOrder(client, o) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.orders
       (app_id, tenant_id, sub_tenant_id, buyer_user_id, status, currency,
        subtotal_cents, tax_cents, shipping_cents, total_cents,
        idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      o.appId, o.tenantId, o.subTenantId ?? null, o.buyerUserId, o.status,
      o.currency, o.subtotalCents, o.taxCents ?? 0, o.shippingCents ?? 0,
      o.totalCents, o.idempotencyKey ?? null, o.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function insertItems(client, orderId, appId, tenantId, items) {
  for (const it of items) {
    await client.query(
      `INSERT INTO ${SCHEMA}.order_items
         (app_id, tenant_id, order_id, sku, product_name, qty, unit_price_cents, vendor_tenant_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [appId, tenantId, orderId, it.sku, it.productName, it.qty, it.unitPriceCents, it.vendorTenantId ?? null, it.metadata ?? {}],
    )
  }
}

// ── Post-creation item editing ──────────────────────────────────────────

export async function insertItem(client, orderId, appId, tenantId, it) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.order_items
       (app_id, tenant_id, order_id, sku, product_name, qty, unit_price_cents, vendor_tenant_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [appId, tenantId, orderId, it.sku, it.productName, it.qty, it.unitPriceCents, it.vendorTenantId ?? null, it.metadata ?? {}],
  )
  return rows[0]
}

export async function findItemById(client, appId, tenantId, orderId, itemId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.order_items
       WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3 AND id=$4`,
    [appId, tenantId, orderId, itemId],
  )
  return rows[0] ?? null
}

export async function deleteItem(client, appId, tenantId, orderId, itemId) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.order_items
       WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3 AND id=$4`,
    [appId, tenantId, orderId, itemId],
  )
  return rowCount
}

export async function updateItemQty(client, appId, tenantId, orderId, itemId, qty) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.order_items
       SET qty = $5, updated_at = now()
       WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3 AND id=$4
       RETURNING *`,
    [appId, tenantId, orderId, itemId, qty],
  )
  return rows[0] ?? null
}

export async function updateTotals(client, appId, tenantId, orderId, t) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.orders
       SET subtotal_cents = $4, tax_cents = $5, shipping_cents = $6,
           total_cents = $7, updated_at = now()
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3
       RETURNING *`,
    [appId, tenantId, orderId, t.subtotalCents, t.taxCents, t.shippingCents, t.totalCents],
  )
  return rows[0] ?? null
}

export async function updateShipment(client, appId, tenantId, orderId, shipmentId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.orders
       SET shipment_id = $4, updated_at = now()
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3
       RETURNING *`,
    [appId, tenantId, orderId, shipmentId],
  )
  return rows[0] ?? null
}

// ── Order modifications (post-creation audit trail) ─────────────────────

export async function insertModification(client, m) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.order_modifications
       (app_id, tenant_id, order_id, modification_type, before_value, after_value, reason, actor_user_id, actor_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      m.appId, m.tenantId, m.orderId, m.type,
      m.before != null ? JSON.stringify(m.before) : null,
      m.after  != null ? JSON.stringify(m.after)  : null,
      m.reason ?? null, m.actorUserId ?? null, m.actorRole ?? null,
    ],
  )
  return rows[0]
}

export async function listModifications(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.order_modifications
       WHERE app_id = $1 AND tenant_id = $2 AND order_id = $3
       ORDER BY created_at DESC`,
    [appId, tenantId, orderId],
  )
  return rows
}

export async function findShippingAddress(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.order_addresses
       WHERE app_id = $1 AND tenant_id = $2 AND order_id = $3 AND kind = 'shipping'
       LIMIT 1`,
    [appId, tenantId, orderId],
  )
  return rows[0] ?? null
}

export async function replaceShippingAddress(client, appId, tenantId, orderId, addr) {
  await client.query(
    `DELETE FROM ${SCHEMA}.order_addresses
      WHERE app_id = $1 AND tenant_id = $2 AND order_id = $3 AND kind = 'shipping'`,
    [appId, tenantId, orderId],
  )
  await insertAddress(client, orderId, appId, tenantId, { kind: 'shipping', ...addr })
}

export async function insertAddress(client, orderId, appId, tenantId, addr) {
  await client.query(
    `INSERT INTO ${SCHEMA}.order_addresses
       (app_id, tenant_id, order_id, kind, full_name, line1, line2, city, region, postal_code, country, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      appId, tenantId, orderId, addr.kind,
      addr.fullName ?? null, addr.line1 ?? null, addr.line2 ?? null,
      addr.city ?? null, addr.region ?? null, addr.postalCode ?? null,
      addr.country ?? null, addr.phone ?? null,
    ],
  )
}

export async function recordStatusChange(client, orderId, appId, tenantId, fromStatus, toStatus, actor, reason) {
  await client.query(
    `INSERT INTO ${SCHEMA}.order_status_history
       (app_id, tenant_id, order_id, from_status, to_status, actor_user_id, actor_role, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [appId, tenantId, orderId, fromStatus, toStatus, actor?.userId ?? null, actor?.role ?? null, reason ?? null],
  )
}

export async function findOrderById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.orders WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findOrderByIdempotencyKey(client, appId, tenantId, key) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.orders WHERE app_id=$1 AND tenant_id=$2 AND idempotency_key=$3`,
    [appId, tenantId, key],
  )
  return rows[0] ?? null
}

export async function findItemsByOrderId(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.order_items WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3`,
    [appId, tenantId, orderId],
  )
  return rows
}

export async function findAddressesByOrderId(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.order_addresses WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3`,
    [appId, tenantId, orderId],
  )
  return rows
}

export async function findHistoryByOrderId(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.order_status_history
     WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3 ORDER BY ts ASC`,
    [appId, tenantId, orderId],
  )
  return rows
}

// Shared WHERE builder for listOrders / exportOrders. Returns the filter SQL
// (scoped by app_id + tenant_id first) and the positional params it consumed,
// so the caller can append its own trailing params (LIMIT/OFFSET) afterward.
function buildOrderFilters(appId, tenantId, opts = {}) {
  const { buyerUserId, status, vendorTenantId, createdAfter, createdBefore, totalMinCents, totalMaxCents } = opts
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (buyerUserId)    { filters.push(`buyer_user_id = $${i++}`);  params.push(buyerUserId) }
  if (status)         { filters.push(`status = $${i++}`);         params.push(status) }
  if (createdAfter)   { filters.push(`created_at >= $${i++}`);    params.push(createdAfter) }
  if (createdBefore)  { filters.push(`created_at <= $${i++}`);    params.push(createdBefore) }
  if (totalMinCents != null) { filters.push(`total_cents >= $${i++}`); params.push(totalMinCents) }
  if (totalMaxCents != null) { filters.push(`total_cents <= $${i++}`); params.push(totalMaxCents) }
  if (vendorTenantId) {
    filters.push(
      `EXISTS (SELECT 1 FROM ${SCHEMA}.order_items oi
                 WHERE oi.order_id = ${SCHEMA}.orders.id
                   AND oi.app_id = $1 AND oi.tenant_id = $2
                   AND oi.vendor_tenant_id = $${i++})`,
    )
    params.push(vendorTenantId)
  }
  return { where: filters.join(' AND '), params, nextIndex: i }
}

export async function listOrders(client, appId, tenantId, opts = {}) {
  const { limit = 50, offset = 0 } = opts
  const { where, params, nextIndex } = buildOrderFilters(appId, tenantId, opts)
  let i = nextIndex
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.orders
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    params,
  )
  return rows
}

// Streams the full filtered set (no LIMIT/OFFSET) for CSV export. Capped at a
// hard ceiling so a runaway export can't exhaust memory.
export async function exportOrders(client, appId, tenantId, opts = {}) {
  const cap = Math.min(opts.maxRows ?? 50000, 50000)
  const { where, params, nextIndex } = buildOrderFilters(appId, tenantId, opts)
  let i = nextIndex
  params.push(cap)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.orders
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${i++}`,
    params,
  )
  return rows
}

export async function updateStatus(client, appId, tenantId, id, toStatus) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.orders
     SET status = $4, updated_at = now()
     WHERE app_id = $1 AND tenant_id = $2 AND id = $3
     RETURNING *`,
    [appId, tenantId, id, toStatus],
  )
  return rows[0] ?? null
}

export async function updatePaymentIntent(client, appId, tenantId, id, paymentIntentId) {
  await client.query(
    `UPDATE ${SCHEMA}.orders
     SET stripe_payment_intent_id = $4, updated_at = now()
     WHERE app_id = $1 AND tenant_id = $2 AND id = $3`,
    [appId, tenantId, id, paymentIntentId],
  )
}
