function rowToRefund(row) {
  return {
    id: row.id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    subTenantId: row.sub_tenant_id,
    transactionId: row.transaction_id,
    providerRefundId: row.provider_refund_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export { rowToRefund }

export async function insertRefund(client, ctx, data) {
  const { rows } = await client.query(
    `INSERT INTO platform_payments.refunds
       (app_id, tenant_id, sub_tenant_id, transaction_id, provider_refund_id,
        amount_cents, currency, reason, status, idempotency_key, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, data.transactionId,
      data.providerRefundId ?? null, data.amountCents, data.currency,
      data.reason ?? null, data.status, data.idempotencyKey ?? null,
      data.createdByUserId ?? null,
    ],
  )
  return rowToRefund(rows[0])
}

// Sum of already-refunded (non-failed) amounts for a transaction — used to
// enforce that cumulative partial refunds never exceed the original charge.
export async function sumRefundedCents(client, ctx, transactionId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
       FROM platform_payments.refunds
      WHERE app_id = $1 AND tenant_id = $2 AND transaction_id = $3
        AND status <> 'failed'`,
    [ctx.appId, ctx.tenantId, transactionId],
  )
  return rows[0]?.total ?? 0
}

export async function listByTransaction(client, ctx, transactionId) {
  const { rows } = await client.query(
    `SELECT * FROM platform_payments.refunds
      WHERE app_id = $1 AND tenant_id = $2 AND transaction_id = $3
      ORDER BY created_at DESC`,
    [ctx.appId, ctx.tenantId, transactionId],
  )
  return rows.map(rowToRefund)
}

export async function updateStatusByProviderRefundId(client, providerRefundId, status) {
  const { rows } = await client.query(
    `UPDATE platform_payments.refunds
        SET status = $1, updated_at = now()
      WHERE provider_refund_id = $2
      RETURNING *`,
    [status, providerRefundId],
  )
  return rows[0] ? rowToRefund(rows[0]) : null
}
