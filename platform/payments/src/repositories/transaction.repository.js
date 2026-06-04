import { NotFoundError } from '@apphub/platform-sdk/errors'

function rowToTransaction(row) {
  return {
    id: row.id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    subTenantId: row.sub_tenant_id,
    userId: row.user_id,
    provider: row.provider,
    providerTxId: row.provider_tx_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export { rowToTransaction }

// All inserts/selects below run inside withTenantTransaction, so RLS already
// scopes them to (app_id, tenant_id). We still pass app_id/tenant_id explicitly
// on INSERT because RLS does not supply column defaults.
export async function insertTransaction(client, ctx, data) {
  const { rows } = await client.query(
    `INSERT INTO platform_payments.transactions
       (app_id, tenant_id, sub_tenant_id, user_id, provider, provider_tx_id,
        amount_cents, currency, status, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, data.userId,
      data.provider ?? 'stripe', data.providerTxId ?? null,
      data.amountCents, data.currency, data.status,
      data.idempotencyKey ?? null, JSON.stringify(data.metadata ?? {}),
    ],
  )
  return rowToTransaction(rows[0])
}

export async function findById(client, ctx, id) {
  const { rows } = await client.query(
    `SELECT * FROM platform_payments.transactions
      WHERE id = $1 AND app_id = $2 AND tenant_id = $3`,
    [id, ctx.appId, ctx.tenantId],
  )
  if (!rows[0]) throw new NotFoundError('Transaction')
  return rowToTransaction(rows[0])
}

export async function findByProviderTxId(client, providerTxId) {
  const { rows } = await client.query(
    `SELECT * FROM platform_payments.transactions WHERE provider_tx_id = $1`,
    [providerTxId],
  )
  return rows[0] ? rowToTransaction(rows[0]) : null
}

export async function updateStatusByProviderTxId(client, providerTxId, status, lastError) {
  const { rows } = await client.query(
    `UPDATE platform_payments.transactions
        SET status = $1, last_error = $2, updated_at = now()
      WHERE provider_tx_id = $3
      RETURNING *`,
    [status, lastError ?? null, providerTxId],
  )
  return rows[0] ? rowToTransaction(rows[0]) : null
}

export async function updateStatus(client, ctx, id, status) {
  const { rows } = await client.query(
    `UPDATE platform_payments.transactions
        SET status = $1, updated_at = now()
      WHERE id = $2 AND app_id = $3 AND tenant_id = $4
      RETURNING *`,
    [status, id, ctx.appId, ctx.tenantId],
  )
  if (!rows[0]) throw new NotFoundError('Transaction')
  return rowToTransaction(rows[0])
}

export async function setProviderTxId(client, ctx, id, providerTxId, status) {
  const { rows } = await client.query(
    `UPDATE platform_payments.transactions
        SET provider_tx_id = $1, status = $2, updated_at = now()
      WHERE id = $3 AND app_id = $4 AND tenant_id = $5
      RETURNING *`,
    [providerTxId, status, id, ctx.appId, ctx.tenantId],
  )
  return rowToTransaction(rows[0])
}

export async function listTransactions(client, ctx, { limit, cursor, status }) {
  const params = [ctx.appId, ctx.tenantId, limit]
  let where = `app_id = $1 AND tenant_id = $2`
  if (status) {
    params.push(status)
    where += ` AND status = $${params.length}`
  }
  if (cursor) {
    params.push(cursor)
    where += ` AND created_at < (SELECT created_at FROM platform_payments.transactions WHERE id = $${params.length})`
  }
  const { rows } = await client.query(
    `SELECT * FROM platform_payments.transactions
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $3`,
    params,
  )
  return rows.map(rowToTransaction)
}
