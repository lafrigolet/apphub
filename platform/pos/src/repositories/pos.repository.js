const SCHEMA = 'platform_pos'

export async function insertBill(client, b) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bills
       (app_id, tenant_id, sub_tenant_id, table_id, table_code, server_user_id, currency, notes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'EUR'),$8,COALESCE($9,'{}'::jsonb)) RETURNING *`,
    [b.appId, b.tenantId, b.subTenantId ?? null, b.tableId ?? null, b.tableCode ?? null,
     b.serverUserId ?? null, b.currency ?? 'EUR', b.notes ?? null, b.metadata ?? {}],
  )
  return rows[0]
}

export async function findBillById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bills WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listBills(client, appId, tenantId, { status, tableId, limit = 100 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (status)  { filters.push(`status = $${i++}`);   params.push(status) }
  if (tableId) { filters.push(`table_id = $${i++}`); params.push(tableId) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bills WHERE ${filters.join(' AND ')}
     ORDER BY opened_at DESC LIMIT $${i++}`,
    params,
  )
  return rows
}

export async function insertBillItem(client, i) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bill_items
       (app_id, tenant_id, bill_id, sku, name, qty, unit_price_cents, modifiers, course, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'[]'::jsonb),COALESCE($9,'main'),$10) RETURNING *`,
    [i.appId, i.tenantId, i.billId, i.sku, i.name, i.qty, i.unitPriceCents,
     JSON.stringify(i.modifiers ?? []), i.course ?? 'main', i.notes ?? null],
  )
  return rows[0]
}

export async function listItemsByBill(client, appId, tenantId, billId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bill_items WHERE app_id=$1 AND tenant_id=$2 AND bill_id=$3
     ORDER BY created_at`,
    [appId, tenantId, billId],
  )
  return rows
}

export async function insertPayment(client, p) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bill_payments
       (app_id, tenant_id, bill_id, method, amount_cents, tip_cents, external_ref)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),$7) RETURNING *`,
    [p.appId, p.tenantId, p.billId, p.method, p.amountCents, p.tipCents ?? 0, p.externalRef ?? null],
  )
  return rows[0]
}

export async function listPaymentsByBill(client, appId, tenantId, billId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bill_payments WHERE app_id=$1 AND tenant_id=$2 AND bill_id=$3
     ORDER BY paid_at`,
    [appId, tenantId, billId],
  )
  return rows
}

export async function setBillTotals(client, appId, tenantId, id, t) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.bills
     SET subtotal_cents=$4, tax_cents=$5, tip_cents=$6, total_cents=$7
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, t.subtotal, t.tax, t.tip, t.total],
  )
  return rows[0] ?? null
}

export async function setBillStatus(client, appId, tenantId, id, status) {
  const closedAt = ['paid','closed','cancelled'].includes(status) ? 'now()' : 'NULL'
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.bills SET status=$4, closed_at=${closedAt}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

export async function cancelBill(client, appId, tenantId, id, cancelledBy, reason) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.bills
     SET status='cancelled', closed_at=now(), cancelled_by=$4, cancel_reason=$5
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, cancelledBy ?? null, reason ?? null],
  )
  return rows[0] ?? null
}

// Items not yet sent to the kitchen for this bill.
export async function listUnfiredItems(client, appId, tenantId, billId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bill_items
     WHERE app_id=$1 AND tenant_id=$2 AND bill_id=$3 AND fired_at IS NULL
     ORDER BY created_at`,
    [appId, tenantId, billId],
  )
  return rows
}

// Mark the given item ids as fired. When ids is empty/undefined, fire every
// still-unfired item of the bill. Returns the rows that transitioned.
export async function markItemsFired(client, appId, tenantId, billId, itemIds) {
  if (itemIds && itemIds.length > 0) {
    const { rows } = await client.query(
      `UPDATE ${SCHEMA}.bill_items SET fired_at=now()
       WHERE app_id=$1 AND tenant_id=$2 AND bill_id=$3
         AND id = ANY($4::uuid[]) AND fired_at IS NULL RETURNING *`,
      [appId, tenantId, billId, itemIds],
    )
    return rows
  }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.bill_items SET fired_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND bill_id=$3 AND fired_at IS NULL RETURNING *`,
    [appId, tenantId, billId],
  )
  return rows
}

export async function insertSplit(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bill_splits (app_id, tenant_id, parent_bill_id, share_index, amount_cents)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [s.appId, s.tenantId, s.parentBillId, s.shareIndex, s.amountCents],
  )
  return rows[0]
}

export async function listSplits(client, appId, tenantId, billId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bill_splits WHERE app_id=$1 AND tenant_id=$2 AND parent_bill_id=$3
     ORDER BY share_index`,
    [appId, tenantId, billId],
  )
  return rows
}

export async function markSplitPaid(client, appId, tenantId, splitId, paymentId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.bill_splits SET paid=TRUE, payment_id=$4
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, splitId, paymentId],
  )
  return rows[0] ?? null
}

// ── split-by-item (#6) ────────────────────────────────────────────────────
export async function insertSplitItem(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bill_split_items (app_id, tenant_id, split_id, bill_item_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [s.appId, s.tenantId, s.splitId, s.billItemId],
  )
  return rows[0]
}

export async function listSplitItems(client, appId, tenantId, billId) {
  const { rows } = await client.query(
    `SELECT si.* FROM ${SCHEMA}.bill_split_items si
     JOIN ${SCHEMA}.bill_splits s ON s.id = si.split_id
     WHERE si.app_id=$1 AND si.tenant_id=$2 AND s.parent_bill_id=$3
     ORDER BY si.split_id`,
    [appId, tenantId, billId],
  )
  return rows
}

// ── per-tenant settings (#5) ──────────────────────────────────────────────
export async function getSettings(client, appId, tenantId, subTenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.pos_settings
     WHERE app_id=$1 AND tenant_id=$2 AND sub_tenant_id IS NOT DISTINCT FROM $3`,
    [appId, tenantId, subTenantId ?? null],
  )
  return rows[0] ?? null
}

export async function upsertSettings(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.pos_settings
       (app_id, tenant_id, sub_tenant_id, tip_suggestions, tip_allow_custom, default_tax_rate, updated_at)
     VALUES ($1,$2,$3,COALESCE($4,'[]'::jsonb),COALESCE($5,TRUE),$6, now())
     ON CONFLICT (app_id, tenant_id, sub_tenant_id) DO UPDATE SET
       tip_suggestions  = COALESCE(EXCLUDED.tip_suggestions, ${SCHEMA}.pos_settings.tip_suggestions),
       tip_allow_custom = COALESCE(EXCLUDED.tip_allow_custom, ${SCHEMA}.pos_settings.tip_allow_custom),
       default_tax_rate = EXCLUDED.default_tax_rate,
       updated_at       = now()
     RETURNING *`,
    [
      s.appId, s.tenantId, s.subTenantId ?? null,
      s.tipSuggestions !== undefined ? JSON.stringify(s.tipSuggestions) : null,
      s.tipAllowCustom ?? null,
      s.defaultTaxRate ?? null,
    ],
  )
  return rows[0]
}
