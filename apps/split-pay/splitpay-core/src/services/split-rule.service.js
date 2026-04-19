import { pool, withTenant } from '../lib/db.js'
import { cacheGet, cacheSet, cacheDelete } from '../lib/redis.js'
import * as repo from '../repositories/split-rule.repository.js'
import { simulateSplit } from '../utils/split-engine.js'

const CACHE_TTL = 60 // 1 minute

function cacheKey(tenantId, id) {
  return `split_rule:${tenantId}:${id}`
}

export async function createSplitRule(ctx, input) {
  return withTenant(ctx.tenantId, ctx.subTenantId, (client) =>
    repo.createSplitRule(client, ctx, input),
  )
}

export async function getSplitRule(ctx, id) {
  const cached = await cacheGet(cacheKey(ctx.tenantId, id))
  if (cached) return cached

  const client = await pool.connect()
  try {
    const rule = await repo.findSplitRuleById(client, ctx, id)
    await cacheSet(cacheKey(ctx.tenantId, id), rule, CACHE_TTL)
    return rule
  } finally {
    client.release()
  }
}

export async function listSplitRules(ctx) {
  const client = await pool.connect()
  try {
    return repo.listSplitRules(client, ctx)
  } finally {
    client.release()
  }
}

export async function deactivateSplitRule(ctx, id) {
  await withTenant(ctx.tenantId, ctx.subTenantId, (client) =>
    repo.deactivateSplitRule(client, ctx, id),
  )
  await cacheDelete(cacheKey(ctx.tenantId, id))
}

export async function simulate(ctx, splitRuleId, amount, currency) {
  const rule = await getSplitRule(ctx, splitRuleId)
  return simulateSplit(amount, currency, rule)
}
