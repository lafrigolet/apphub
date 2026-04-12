import type pg from 'pg'
import type { ConnectAccount, TenantContext } from '../types/index.js'
import { NotFoundError } from '../utils/errors.js'

interface ConnectAccountRow {
  id: string
  tenant_id: string
  sub_tenant_id: string | null
  stripe_account_id: string
  email: string
  status: 'pending' | 'active' | 'restricted' | 'disabled'
  payouts_enabled: boolean
  charges_enabled: boolean
  created_at: Date
  updated_at: Date
}

function rowToAccount(row: ConnectAccountRow): ConnectAccount {
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

export async function insertConnectAccount(
  client: pg.PoolClient,
  ctx: TenantContext,
  data: { stripeAccountId: string; email: string },
): Promise<ConnectAccount> {
  const { rows } = await client.query<ConnectAccountRow>(
    `INSERT INTO payments.connect_accounts
       (tenant_id, sub_tenant_id, stripe_account_id, email)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [ctx.tenantId, ctx.subTenantId, data.stripeAccountId, data.email],
  )
  return rowToAccount(rows[0]!)
}

export async function findConnectAccountByStripeId(
  client: pg.PoolClient,
  stripeAccountId: string,
): Promise<ConnectAccount | null> {
  const { rows } = await client.query<ConnectAccountRow>(
    `SELECT * FROM payments.connect_accounts WHERE stripe_account_id = $1`,
    [stripeAccountId],
  )
  return rows[0] ? rowToAccount(rows[0]) : null
}

export async function findConnectAccountById(
  client: pg.PoolClient,
  ctx: TenantContext,
  id: string,
): Promise<ConnectAccount> {
  const { rows } = await client.query<ConnectAccountRow>(
    `SELECT * FROM payments.connect_accounts WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId],
  )
  if (!rows[0]) throw new NotFoundError('Connect account')
  return rowToAccount(rows[0])
}

export async function updateConnectAccountStatus(
  client: pg.PoolClient,
  stripeAccountId: string,
  status: ConnectAccount['status'],
  payoutsEnabled: boolean,
  chargesEnabled: boolean,
): Promise<void> {
  await client.query(
    `UPDATE payments.connect_accounts
     SET status = $1, payouts_enabled = $2, charges_enabled = $3, updated_at = now()
     WHERE stripe_account_id = $4`,
    [status, payoutsEnabled, chargesEnabled, stripeAccountId],
  )
}

export async function listConnectAccounts(
  client: pg.PoolClient,
  ctx: TenantContext,
): Promise<ConnectAccount[]> {
  const { rows } = await client.query<ConnectAccountRow>(
    `SELECT * FROM payments.connect_accounts WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [ctx.tenantId],
  )
  return rows.map(rowToAccount)
}
