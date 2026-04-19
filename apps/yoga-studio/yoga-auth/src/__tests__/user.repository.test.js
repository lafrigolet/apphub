import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as userRepo from '../repositories/user.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

describe('user.repository', () => {
  describe('findByEmail', () => {
    it('returns user when found', async () => {
      const user = { id: USER_ID, email: 'a@b.com', role: 'alumno', tenant_id: TENANT_ID }
      const client = makeClient([user])
      const result = await userRepo.findByEmail(client, 'a@b.com', TENANT_ID)
      expect(result).toEqual(user)
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE email = $1 AND tenant_id = $2'),
        ['a@b.com', TENANT_ID],
      )
    })

    it('returns null when not found', async () => {
      const client = makeClient([])
      const result = await userRepo.findByEmail(client, 'missing@b.com', TENANT_ID)
      expect(result).toBeNull()
    })
  })

  describe('findById', () => {
    it('returns user by id scoped to tenant', async () => {
      const user = { id: USER_ID, email: 'a@b.com', tenant_id: TENANT_ID }
      const client = makeClient([user])
      const result = await userRepo.findById(client, USER_ID, TENANT_ID)
      expect(result).toEqual(user)
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
        [USER_ID, TENANT_ID],
      )
    })

    it('returns null when not found', async () => {
      const client = makeClient([])
      const result = await userRepo.findById(client, 'missing-id', TENANT_ID)
      expect(result).toBeNull()
    })
  })

  describe('createUser', () => {
    it('inserts user with tenant and sub_tenant columns', async () => {
      const user = { id: USER_ID, email: 'a@b.com', role: 'alumno', tenant_id: TENANT_ID }
      const client = makeClient([user])
      const result = await userRepo.createUser(client, {
        id: USER_ID, email: 'a@b.com', passwordHash: 'hash', role: 'alumno',
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(user)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('tenant_id')
      expect(sql).toContain('sub_tenant_id')
      expect(params).toContain(TENANT_ID)
      expect(params).toContain(null) // subTenantId
    })

    it('passes subTenantId when provided', async () => {
      const SUB = '00000000-0000-0000-0000-000000000002'
      const client = makeClient([{ id: USER_ID }])
      await userRepo.createUser(client, {
        id: USER_ID, email: 'a@b.com', passwordHash: 'h', role: 'alumno',
        tenantId: TENANT_ID, subTenantId: SUB,
      })
      expect(client.query.mock.calls[0][1]).toContain(SUB)
    })
  })

  describe('incrementFailedAttempts', () => {
    it('updates failed_attempts and conditionally sets locked_until', async () => {
      const client = makeClient([])
      await userRepo.incrementFailedAttempts(client, USER_ID)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('failed_attempts = failed_attempts + 1')
      expect(sql).toContain('locked_until')
      expect(params).toContain(USER_ID)
    })
  })

  describe('resetFailedAttempts', () => {
    it('resets failed_attempts and clears locked_until', async () => {
      const client = makeClient([])
      await userRepo.resetFailedAttempts(client, USER_ID)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('failed_attempts = 0')
      expect(sql).toContain('locked_until = NULL')
      expect(params).toContain(USER_ID)
    })
  })

  describe('updatePassword', () => {
    it('updates password_hash and resets lock fields', async () => {
      const client = makeClient([])
      await userRepo.updatePassword(client, USER_ID, 'newHash')
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('password_hash = $2')
      expect(sql).toContain('failed_attempts = 0')
      expect(params).toEqual([USER_ID, 'newHash'])
    })
  })

  describe('confirmEmail', () => {
    it('sets email_confirmed to true', async () => {
      const client = makeClient([])
      await userRepo.confirmEmail(client, USER_ID)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('email_confirmed = true')
      expect(params).toContain(USER_ID)
    })
  })
})
