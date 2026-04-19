import { describe, it, expect, vi } from 'vitest'
import * as bonusRepo from '../repositories/bonus.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BONUS_ID = '66666666-6666-6666-6666-666666666666'
const BONUS_TYPE_ID = '77777777-7777-7777-7777-777777777777'

function makeClient(rows = []) {
  const mockQuery = vi.fn()
  const client = { query: mockQuery, release: vi.fn() }
  if (Array.isArray(rows[0])) {
    rows.forEach((r) => mockQuery.mockResolvedValueOnce({ rows: r }))
  } else {
    mockQuery.mockResolvedValue({ rows })
  }
  return client
}

describe('bonus.repository', () => {
  describe('getActiveBonuses', () => {
    it('returns active bonuses for user scoped to tenant', async () => {
      const bonus = { id: BONUS_ID, user_id: USER_ID, tenant_id: TENANT_ID, is_active: true }
      const client = makeClient([bonus])
      const result = await bonusRepo.getActiveBonuses(client, USER_ID, TENANT_ID)
      expect(result).toEqual([bonus])
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('b.user_id = $1 AND b.tenant_id = $2')
      expect(sql).toContain('b.is_active = true')
      expect(params).toEqual([USER_ID, TENANT_ID])
    })
  })

  describe('checkAndDeductCredit', () => {
    it('returns null when no eligible bonus found', async () => {
      const client = makeClient([])
      const result = await bonusRepo.checkAndDeductCredit(client, USER_ID, TENANT_ID)
      expect(result).toBeNull()
    })

    it('deducts session and logs credit when bonus exists', async () => {
      const bonus = { id: BONUS_ID, sessions_used: 2, sessions_total: 10 }
      const updated = { ...bonus, sessions_used: 3 }
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [bonus] })   // FOR UPDATE select
          .mockResolvedValueOnce({ rows: [updated] }) // UPDATE bonus
          .mockResolvedValueOnce({ rows: [] }),        // INSERT credit_log
        release: vi.fn(),
      }
      const result = await bonusRepo.checkAndDeductCredit(client, USER_ID, TENANT_ID)
      expect(result).toEqual(updated)
      expect(client.query).toHaveBeenCalledTimes(3)
      const logCall = client.query.mock.calls[2]
      expect(logCall[0]).toContain('credit_log')
      expect(logCall[0]).toContain('-1') // delta hardcoded in SQL
      expect(logCall[0]).toContain("'booking'")
    })
  })

  describe('returnCredit', () => {
    it('increments sessions_used back on earliest active bonus', async () => {
      const bonus = { id: BONUS_ID, tenant_id: TENANT_ID, sub_tenant_id: null }
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [bonus] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      await bonusRepo.returnCredit(client, USER_ID, TENANT_ID)
      const updateCall = client.query.mock.calls[1]
      expect(updateCall[0]).toContain('GREATEST(0, sessions_used - 1)')
      const logCall = client.query.mock.calls[2]
      expect(logCall[0]).toContain('1') // delta hardcoded in SQL
      expect(logCall[0]).toContain('cancellation_refund')
    })

    it('does nothing when no active bonus found', async () => {
      const client = makeClient([])
      await bonusRepo.returnCredit(client, USER_ID, TENANT_ID)
      expect(client.query).toHaveBeenCalledTimes(1) // only the SELECT
    })
  })

  describe('activateBonusByPayment', () => {
    it('creates bonus from bonus type data', async () => {
      const bonusType = { id: BONUS_TYPE_ID, sessions_count: 10, validity_days: 30 }
      const newBonus = { id: BONUS_ID, user_id: USER_ID }
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [bonusType] })
          .mockResolvedValueOnce({ rows: [newBonus] }),
        release: vi.fn(),
      }
      const result = await bonusRepo.activateBonusByPayment(client, {
        id: BONUS_ID, userId: USER_ID, bonusTypeId: BONUS_TYPE_ID,
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(newBonus)
      const [insertSql] = client.query.mock.calls[1]
      expect(insertSql).toContain('activated_by')
      expect(insertSql).toContain("'payment'") // hardcoded in SQL
    })

    it('returns null when bonus type not found', async () => {
      const client = makeClient([])
      const result = await bonusRepo.activateBonusByPayment(client, {
        id: BONUS_ID, userId: USER_ID, bonusTypeId: 'missing', tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toBeNull()
    })
  })

  describe('createBonusType', () => {
    it('inserts bonus_type with tenant_id only (no sub_tenant_id)', async () => {
      const bonusType = { id: BONUS_TYPE_ID, name: 'Pack 10', type: 'sessions', tenant_id: TENANT_ID }
      const client = makeClient([bonusType])
      const result = await bonusRepo.createBonusType(client, {
        id: BONUS_TYPE_ID, name: 'Pack 10', type: 'sessions', sessionsCount: 10,
        validityDays: 30, priceEur: 80, tenantId: TENANT_ID,
      })
      expect(result).toEqual(bonusType)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('tenant_id')
      expect(sql).not.toContain('sub_tenant_id')
      expect(params).toContain(TENANT_ID)
    })
  })

  describe('adjustCredits', () => {
    it('updates sessions_total and logs the adjustment', async () => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      }
      await bonusRepo.adjustCredits(client, {
        bonusId: BONUS_ID, delta: 5, reason: 'admin_gift', tenantId: TENANT_ID, subTenantId: null,
      })
      expect(client.query).toHaveBeenCalledTimes(2)
      const [updateSql] = client.query.mock.calls[0]
      expect(updateSql).toContain('sessions_total = sessions_total + $2')
      const [logSql, logParams] = client.query.mock.calls[1]
      expect(logSql).toContain('credit_log')
      expect(logParams).toContain('admin_gift')
    })
  })

  describe('findExpiringBonuses', () => {
    it('returns bonuses expiring within 7 days or with <= 2 sessions left', async () => {
      const expiring = [{ id: BONUS_ID, expires_at: new Date() }]
      const client = makeClient(expiring)
      const result = await bonusRepo.findExpiringBonuses(client)
      expect(result).toEqual(expiring)
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain('INTERVAL \'7 days\'')
      expect(sql).toContain('sessions_total - b.sessions_used')
    })
  })
})
