// split-rule.service — CRUD + cache + simulate.
// Foco: cache HIT/MISS, cache invalidation on deactivate, simulate composition.
//
// Contrato:
//   - getSplitRule:
//       · cache HIT (cacheGet returns non-null) → return cached sin tocar DB.
//       · cache MISS → repo.findSplitRuleById + cacheSet con TTL 60s.
//   - deactivateSplitRule:
//       · llama repo.deactivate.
//       · INVALIDA cache después (cacheDelete) — sin esto, 60s de window de
//         leakage donde la rule sigue "activa" para new payments.
//   - simulate: getSplitRule (cacheable) + simulateSplit.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    SPLITPAY_STRIPE_SECRET_KEY: 'sk_test', SPLITPAY_STRIPE_WEBHOOK_SECRET: 'whsec',
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
  },
}))
const fakeClient = vi.hoisted(() => ({ release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
  withTenant: vi.fn(async (_t, _s, fn) => fn(fakeClient)),
}))
const redisMock = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDelete: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/redis.js', () => redisMock)
vi.mock('../repositories/split-rule.repository.js')

import {
  createSplitRule, getSplitRule, listSplitRules,
  deactivateSplitRule, simulate,
} from '../services/split-rule.service.js'
import * as repo from '../repositories/split-rule.repository.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null }
const RULE = 'rule-1'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── createSplitRule ────────────────────────────────────────────────

describe('createSplitRule', () => {
  it('delega a repo dentro de withTenant', async () => {
    repo.createSplitRule.mockResolvedValue({ id: RULE })
    const r = await createSplitRule(ctx, {
      name: 'Default', platformFeePercent: 10,
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
    })
    expect(r.id).toBe(RULE)
    expect(repo.createSplitRule).toHaveBeenCalledWith(fakeClient, ctx, expect.any(Object))
  })
})

// ── getSplitRule — cache ────────────────────────────────────────────

describe('getSplitRule — Redis cache', () => {
  it('cache HIT → return cached, no DB lookup, no cacheSet (no-op)', async () => {
    const cachedRule = { id: RULE, platformFeePercent: 10, recipients: [] }
    redisMock.cacheGet.mockResolvedValue(cachedRule)
    const r = await getSplitRule(ctx, RULE)
    expect(r).toEqual(cachedRule)
    expect(repo.findSplitRuleById).not.toHaveBeenCalled()
    expect(redisMock.cacheSet).not.toHaveBeenCalled()
  })

  it('cache MISS → repo lookup + cacheSet con TTL 60s', async () => {
    redisMock.cacheGet.mockResolvedValue(null)
    const dbRule = { id: RULE, platformFeePercent: 10, recipients: [] }
    repo.findSplitRuleById.mockResolvedValue(dbRule)
    const r = await getSplitRule(ctx, RULE)
    expect(r).toEqual(dbRule)
    expect(redisMock.cacheSet).toHaveBeenCalledWith(
      `split_rule:${ctx.tenantId}:${RULE}`,
      dbRule, 60,
    )
  })

  it('cache key namespace = "split_rule:<tenantId>:<id>" (anti cross-tenant leak)', async () => {
    redisMock.cacheGet.mockResolvedValue(null)
    repo.findSplitRuleById.mockResolvedValue({ id: RULE })
    await getSplitRule(ctx, RULE)
    expect(redisMock.cacheGet).toHaveBeenCalledWith(`split_rule:${ctx.tenantId}:${RULE}`)
    expect(redisMock.cacheSet.mock.calls[0][0]).toMatch(`split_rule:${ctx.tenantId}:`)
  })

  it('libera client del pool incluso si repo lanza', async () => {
    redisMock.cacheGet.mockResolvedValue(null)
    repo.findSplitRuleById.mockRejectedValue(new Error('DB down'))
    await expect(getSplitRule(ctx, RULE)).rejects.toThrow('DB down')
    expect(fakeClient.release).toHaveBeenCalled()
  })
})

// ── listSplitRules ─────────────────────────────────────────────────

describe('listSplitRules', () => {
  it('delega a repo (no cache para listas — siempre actual)', async () => {
    repo.listSplitRules.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }])
    const r = await listSplitRules(ctx)
    expect(r).toHaveLength(2)
    expect(redisMock.cacheGet).not.toHaveBeenCalled()        // no cache para list
  })

  it('libera client incluso si repo lanza', async () => {
    repo.listSplitRules.mockRejectedValue(new Error('DB'))
    await expect(listSplitRules(ctx)).rejects.toThrow('DB')
    expect(fakeClient.release).toHaveBeenCalled()
  })
})

// ── deactivateSplitRule — cache invalidation ───────────────────────

describe('deactivateSplitRule', () => {
  it('llama repo.deactivate + INVALIDA cache (cacheDelete)', async () => {
    await deactivateSplitRule(ctx, RULE)
    expect(repo.deactivateSplitRule).toHaveBeenCalledWith(fakeClient, ctx, RULE)
    expect(redisMock.cacheDelete).toHaveBeenCalledWith(`split_rule:${ctx.tenantId}:${RULE}`)
  })

  it('cache invalidation OCURRE DESPUÉS de DB (no podemos invalidar antes y luego fallar)', async () => {
    const order = []
    repo.deactivateSplitRule.mockImplementation(async () => { order.push('db') })
    redisMock.cacheDelete.mockImplementation(async () => { order.push('cache') })
    await deactivateSplitRule(ctx, RULE)
    expect(order).toEqual(['db', 'cache'])
  })
})

// ── simulate — usa cache de getSplitRule ──────────────────────────

describe('simulate', () => {
  it('delega getSplitRule + simulateSplit', async () => {
    redisMock.cacheGet.mockResolvedValue({
      platformFeePercent: 10,
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
    })
    const r = await simulate(ctx, RULE, 5000, 'eur')
    expect(r).toMatchObject({
      grossAmount: 5000, currency: 'eur',
      stripeFee: expect.any(Number),
      netAmount: expect.any(Number),
      platformFee: expect.any(Number),
      recipients: expect.arrayContaining([
        expect.objectContaining({ accountId: 'a1' }),
      ]),
    })
  })

  it('amount <= 0 → propaga ValidationError de simulateSplit', async () => {
    redisMock.cacheGet.mockResolvedValue({
      platformFeePercent: 10,
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
    })
    await expect(simulate(ctx, RULE, 0, 'eur')).rejects.toThrow(/greater than zero/)
  })

  it('amount tan pequeño que netAmount < 0 → ValidationError', async () => {
    redisMock.cacheGet.mockResolvedValue({
      platformFeePercent: 10,
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
    })
    await expect(simulate(ctx, RULE, 20, 'eur')).rejects.toThrow(/net amount/)
  })
})
