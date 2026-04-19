import { describe, it, expect, vi } from 'vitest'
import * as resetRepo from '../repositories/password-reset.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const TOKEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

describe('password-reset.repository', () => {
  describe('createReset', () => {
    it('inserts reset token with tenant and expiry', async () => {
      const client = makeClient([])
      const expiresAt = new Date(Date.now() + 3_600_000)
      await resetRepo.createReset(client, { token: TOKEN, userId: USER_ID, expiresAt, tenantId: TENANT_ID, subTenantId: null })
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('INSERT INTO yoga_auth.password_resets')
      expect(sql).toContain('tenant_id')
      expect(sql).toContain('sub_tenant_id')
      expect(params).toEqual([TOKEN, USER_ID, expiresAt, TENANT_ID, null])
    })

    it('includes subTenantId when provided', async () => {
      const client = makeClient([])
      const SUB = '00000000-0000-0000-0000-000000000002'
      await resetRepo.createReset(client, { token: TOKEN, userId: USER_ID, expiresAt: new Date(), tenantId: TENANT_ID, subTenantId: SUB })
      expect(client.query.mock.calls[0][1]).toContain(SUB)
    })
  })

  describe('findValidReset', () => {
    it('returns reset record when found and valid', async () => {
      const record = { token: TOKEN, user_id: USER_ID, used_at: null }
      const client = makeClient([record])
      const result = await resetRepo.findValidReset(client, TOKEN)
      expect(result).toEqual(record)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('used_at IS NULL')
      expect(sql).toContain('expires_at > NOW()')
      expect(params).toEqual([TOKEN])
    })

    it('returns null when not found', async () => {
      const client = makeClient([])
      const result = await resetRepo.findValidReset(client, 'bad-token')
      expect(result).toBeNull()
    })
  })

  describe('markResetUsed', () => {
    it('sets used_at on the token', async () => {
      const client = makeClient([])
      await resetRepo.markResetUsed(client, TOKEN)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('SET used_at = NOW()')
      expect(sql).toContain('WHERE token = $1')
      expect(params).toEqual([TOKEN])
    })
  })
})
