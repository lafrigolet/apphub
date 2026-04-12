import type pg from 'pg'
import type { SplitRule, CreateSplitRuleInput, TenantContext } from '../types/index.js'
import { NotFoundError } from '../utils/errors.js'

interface SplitRuleRow {
  id: string
  tenant_id: string
  sub_tenant_id: string | null
  name: string
  platform_fee_percent: string
  recipients: string
  active: boolean
  created_at: Date
  updated_at: Date
}

function rowToSplitRule(row: SplitRuleRow): SplitRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subTenantId: row.sub_tenant_id,
    name: row.name,
    platformFeePercent: parseFloat(row.platform_fee_percent),
    recipients: typeof row.recipients === 'string' ? JSON.parse(row.recipients) : row.recipients,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createSplitRule(
  client: pg.PoolClient,
  ctx: TenantContext,
  input: CreateSplitRuleInput,
): Promise<SplitRule> {
  const { rows } = await client.query<SplitRuleRow>(
    `INSERT INTO payments.split_rules
       (tenant_id, sub_tenant_id, name, platform_fee_percent, recipients)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [ctx.tenantId, ctx.subTenantId, input.name, input.platformFeePercent, JSON.stringify(input.recipients)],
  )
  return rowToSplitRule(rows[0]!)
}

export async function findSplitRuleById(
  client: pg.PoolClient,
  ctx: TenantContext,
  id: string,
): Promise<SplitRule> {
  const { rows } = await client.query<SplitRuleRow>(
    `SELECT * FROM payments.split_rules
     WHERE id = $1 AND tenant_id = $2 AND active = true`,
    [id, ctx.tenantId],
  )
  if (!rows[0]) throw new NotFoundError('Split rule')
  return rowToSplitRule(rows[0])
}

export async function listSplitRules(
  client: pg.PoolClient,
  ctx: TenantContext,
): Promise<SplitRule[]> {
  const { rows } = await client.query<SplitRuleRow>(
    `SELECT * FROM payments.split_rules
     WHERE tenant_id = $1 AND active = true
     ORDER BY created_at DESC`,
    [ctx.tenantId],
  )
  return rows.map(rowToSplitRule)
}

export async function deactivateSplitRule(
  client: pg.PoolClient,
  ctx: TenantContext,
  id: string,
): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE payments.split_rules
     SET active = false, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId],
  )
  if (!rowCount) throw new NotFoundError('Split rule')
}
