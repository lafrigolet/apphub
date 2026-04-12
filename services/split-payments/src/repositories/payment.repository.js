import { NotFoundError } from '../utils/errors.js'

function rowToPayment(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subTenantId: row.sub_tenant_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    splitRuleId: row.split_rule_id,
    merchantAccountId: row.merchant_account_id,
    platformFee: row.platform_fee,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function insertPayment(client, ctx, data) {
  const { rows } = await client.query(
    `INSERT INTO payments.transactions
       (tenant_id, sub_tenant_id, stripe_payment_intent_id, amount, currency,
        status, split_rule_id, merchant_account_id, platform_fee, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      ctx.tenantId, ctx.subTenantId, data.stripePaymentIntentId, data.amount,
      data.currency, data.status, data.splitRuleId, data.merchantAccountId,
      data.platformFee, JSON.stringify(data.metadata),
    ],
  )
  return rowToPayment(rows[0])
}

export async function findPaymentById(client, ctx, id) {
  const { rows } = await client.query(
    `SELECT * FROM payments.transactions WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId],
  )
  if (!rows[0]) throw new NotFoundError('Payment')
  return rowToPayment(rows[0])
}

export async function findPaymentByStripeId(client, stripePaymentIntentId) {
  const { rows } = await client.query(
    `SELECT * FROM payments.transactions WHERE stripe_payment_intent_id = $1`,
    [stripePaymentIntentId],
  )
  return rows[0] ? rowToPayment(rows[0]) : null
}

export async function updatePaymentStatus(client, stripePaymentIntentId, status) {
  await client.query(
    `UPDATE payments.transactions
     SET status = $1, updated_at = now()
     WHERE stripe_payment_intent_id = $2`,
    [status, stripePaymentIntentId],
  )
}

export async function listPayments(client, ctx, limit = 20, cursor) {
  const params = [ctx.tenantId, limit]
  let cursorClause = ''

  if (cursor) {
    params.push(cursor)
    cursorClause = `AND created_at < (SELECT created_at FROM payments.transactions WHERE id = $${params.length})`
  }

  const { rows } = await client.query(
    `SELECT * FROM payments.transactions
     WHERE tenant_id = $1 ${cursorClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params,
  )
  return rows.map(rowToPayment)
}
