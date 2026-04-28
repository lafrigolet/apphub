import { NotFoundError } from '../utils/errors.js'

function rowToAccount(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subTenantId: row.sub_tenant_id,
    stripeAccountId: row.stripe_account_id,
    email: row.email,
    status: row.status,
    payoutsEnabled: row.payouts_enabled,
    chargesEnabled: row.charges_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function insertConnectAccount(client, ctx, data) {
  const { rows } = await client.query(
    `INSERT INTO payments.connect_accounts
       (tenant_id, sub_tenant_id, stripe_account_id, email)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [ctx.tenantId, ctx.subTenantId, data.stripeAccountId, data.email],
  )
  return rowToAccount(rows[0])
}

export async function findConnectAccountByStripeId(client, stripeAccountId) {
  const { rows } = await client.query(
    `SELECT * FROM payments.connect_accounts WHERE stripe_account_id = $1`,
    [stripeAccountId],
  )
  return rows[0] ? rowToAccount(rows[0]) : null
}

export async function findConnectAccountById(client, ctx, id) {
  const { rows } = await client.query(
    `SELECT * FROM payments.connect_accounts WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId],
  )
  if (!rows[0]) throw new NotFoundError('Connect account')
  return rowToAccount(rows[0])
}

export async function updateConnectAccountStatus(
  client,
  stripeAccountId,
  status,
  payoutsEnabled,
  chargesEnabled,
) {
  await client.query(
    `UPDATE payments.connect_accounts
     SET status = $1, payouts_enabled = $2, charges_enabled = $3, updated_at = now()
     WHERE stripe_account_id = $4`,
    [status, payoutsEnabled, chargesEnabled, stripeAccountId],
  )
}

export async function listConnectAccounts(client, ctx) {
  const { rows } = await client.query(
    `SELECT * FROM payments.connect_accounts WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [ctx.tenantId],
  )
  return rows.map(rowToAccount)
}
