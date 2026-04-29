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

export async function listOrders(client, appId, tenantId, { buyerUserId, status, limit = 50, offset = 0 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (buyerUserId) { filters.push(`buyer_user_id = $${i++}`); params.push(buyerUserId) }
  if (status)      { filters.push(`status = $${i++}`);        params.push(status) }
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.orders
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
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
