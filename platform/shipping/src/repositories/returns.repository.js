// Returns / RMA persistence layer. Every query runs inside
// withTenantTransaction so RLS by (app_id, tenant_id) is in effect.

const SCHEMA = 'platform_shipping'

export async function insertReturn(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.returns
       (app_id, tenant_id, order_id, buyer_user_id, status, reason)
     VALUES ($1,$2,$3,$4,COALESCE($5,'requested'),$6)
     RETURNING *`,
    [appId, tenantId, r.orderId, r.buyerUserId, r.status, r.reason ?? null],
  )
  return rows[0]
}

export async function insertReturnItem(client, appId, tenantId, returnId, item) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.return_items
       (app_id, tenant_id, return_id, sku, qty, reason, condition, unit_price_cents, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, returnId, item.sku, item.qty,
      item.reason ?? null, item.condition ?? null, item.unitPriceCents ?? null,
      item.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function findReturnById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.returns WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listReturnItems(client, appId, tenantId, returnId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.return_items
       WHERE app_id=$1 AND tenant_id=$2 AND return_id=$3
       ORDER BY created_at`,
    [appId, tenantId, returnId],
  )
  return rows
}

export async function findReturnItemById(client, appId, tenantId, itemId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.return_items WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, itemId],
  )
  return rows[0] ?? null
}

// Filters: { buyerUserId, orderId, status, limit }
export async function listReturns(client, appId, tenantId, opts = {}) {
  const filters = ['app_id=$1', 'tenant_id=$2']
  const params  = [appId, tenantId]
  if (opts.buyerUserId) { filters.push(`buyer_user_id = $${params.length + 1}`); params.push(opts.buyerUserId) }
  if (opts.orderId)     { filters.push(`order_id      = $${params.length + 1}`); params.push(opts.orderId) }
  if (opts.status)      { filters.push(`status        = $${params.length + 1}`); params.push(opts.status) }
  params.push(opts.limit ?? 50)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.returns
       WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function updateReturn(client, appId, tenantId, id, fields) {
  const allowed = {
    status:              'status',
    inboundShipmentId:   'inbound_shipment_id',
    carrier:             'carrier',
    trackingCode:        'tracking_code',
    decisionNotes:       'decision_notes',
    refundAmountCents:   'refund_amount_cents',
    refundCurrency:      'refund_currency',
    approvedAt:          'approved_at',
    rejectedAt:          'rejected_at',
    shippedAt:           'shipped_at',
    receivedAt:          'received_at',
    restockedAt:         'restocked_at',
    refundedAt:          'refunded_at',
    cancelledAt:         'cancelled_at',
  }
  const sets = []
  const params = [appId, tenantId, id]
  let idx = params.length + 1
  for (const [key, column] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = $${idx++}`)
      params.push(fields[key])
    }
  }
  sets.push(`updated_at = now()`)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.returns SET ${sets.join(', ')}
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function setReturnItemReceived(client, appId, tenantId, itemId, qtyReceived, condition) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.return_items
        SET qty_received = $4, condition = COALESCE($5, condition)
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, itemId, qtyReceived, condition ?? null],
  )
  return rows[0] ?? null
}
