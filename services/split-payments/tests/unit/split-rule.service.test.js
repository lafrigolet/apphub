import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external modules
vi.mock('../../src/lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenant: vi.fn(),
}))

vi.mock('../../src/lib/redis.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDelete: vi.fn(),
}))

vi.mock('../../src/repositories/split-rule.repository.js', () => ({
  createSplitRule: vi.fn(),
  findSplitRuleById: vi.fn(),
  listSplitRules: vi.fn(),
  deactivateSplitRule: vi.fn(),
}))

import * as service from '../../src/services/split-rule.service.js'
import * as repo from '../../src/repositories/split-rule.repository.js'
import * as redis from '../../src/lib/redis.js'
import * as db from '../../src/lib/db.js'

const ctx = { tenantId: 'tenant-abc', subTenantId: null }

const mockRule = {
  id: 'rule-uuid-1',
  tenantId: 'tenant-abc',
  subTenantId: null,
  name: 'Test Rule',
  platformFeePercent: 15,
  recipients: [
    { accountId: 'acct_merchant', label: 'Merchant', percentage: 80 },
    { accountId: 'acct_affiliate', label: 'Affiliate', percentage: 5 },
  ],
  active: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('split-rule.service', () => {
  describe('createSplitRule', () => {
    it('calls withTenant and repo.createSplitRule', async () => {
      vi.mocked(db.withTenant).mockImplementation(async (_tid, _stid, fn) => fn({}))
      vi.mocked(repo.createSplitRule).mockResolvedValue(mockRule)

      const input = {
        name: 'Test Rule',
        platformFeePercent: 15,
        recipients: [
          { accountId: 'acct_merchant', label: 'Merchant', percentage: 80 },
          { accountId: 'acct_affiliate', label: 'Affiliate', percentage: 5 },
        ],
      }

      const result = await service.createSplitRule(ctx, input)
      expect(result).toEqual(mockRule)
      expect(db.withTenant).toHaveBeenCalledWith(ctx.tenantId, ctx.subTenantId, expect.any(Function))
    })
  })

  describe('getSplitRule', () => {
    it('returns cached value without hitting DB', async () => {
      vi.mocked(redis.cacheGet).mockResolvedValue(mockRule)

      const result = await service.getSplitRule(ctx, 'rule-uuid-1')
      expect(result).toEqual(mockRule)
      expect(repo.findSplitRuleById).not.toHaveBeenCalled()
    })

    it('fetches from DB on cache miss and stores in cache', async () => {
      vi.mocked(redis.cacheGet).mockResolvedValue(null)
      const mockClient = { release: vi.fn() }
      vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
      vi.mocked(repo.findSplitRuleById).mockResolvedValue(mockRule)

      const result = await service.getSplitRule(ctx, 'rule-uuid-1')
      expect(result).toEqual(mockRule)
      expect(repo.findSplitRuleById).toHaveBeenCalled()
      expect(redis.cacheSet).toHaveBeenCalledWith(
        expect.stringContaining('rule-uuid-1'),
        mockRule,
        60,
      )
    })
  })

  describe('listSplitRules', () => {
    it('returns all active rules for tenant', async () => {
      const mockClient = { release: vi.fn() }
      vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
      vi.mocked(repo.listSplitRules).mockResolvedValue([mockRule])

      const result = await service.listSplitRules(ctx)
      expect(result).toEqual([mockRule])
      expect(mockClient.release).toHaveBeenCalled()
    })
  })

  describe('deactivateSplitRule', () => {
    it('deactivates rule and clears cache', async () => {
      vi.mocked(db.withTenant).mockImplementation(async (_tid, _stid, fn) => fn({}))
      vi.mocked(repo.deactivateSplitRule).mockResolvedValue(undefined)

      await service.deactivateSplitRule(ctx, 'rule-uuid-1')
      expect(repo.deactivateSplitRule).toHaveBeenCalled()
      expect(redis.cacheDelete).toHaveBeenCalledWith(expect.stringContaining('rule-uuid-1'))
    })
  })

  describe('simulate', () => {
    it('returns simulation for valid rule and amount', async () => {
      vi.mocked(redis.cacheGet).mockResolvedValue(mockRule)

      const sim = await service.simulate(ctx, 'rule-uuid-1', 10000, 'eur')
      expect(sim.grossAmount).toBe(10000)
      expect(sim.currency).toBe('eur')
      expect(sim.stripeFee).toBeGreaterThan(0)
      expect(sim.platformFee).toBeGreaterThan(0)
      expect(sim.recipients).toHaveLength(2)
    })

    it('all amounts sum to grossAmount', async () => {
      vi.mocked(redis.cacheGet).mockResolvedValue(mockRule)

      const sim = await service.simulate(ctx, 'rule-uuid-1', 10000, 'eur')
      const total = sim.stripeFee + sim.platformFee + sim.recipients.reduce((s, r) => s + r.amount, 0)
      expect(total).toBe(sim.grossAmount)
    })
  })
})
