import { describe, it, expect, vi } from 'vitest'
import * as profileRepo from '../repositories/profile.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

describe('profile.repository', () => {
  describe('findById', () => {
    it('returns profile scoped to tenant', async () => {
      const profile = { id: USER_ID, name: 'Ana', email: 'ana@yoga.com', tenant_id: TENANT_ID }
      const client = makeClient([profile])
      const result = await profileRepo.findById(client, USER_ID, TENANT_ID)
      expect(result).toEqual(profile)
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
        [USER_ID, TENANT_ID],
      )
    })

    it('returns null when not found', async () => {
      const client = makeClient([])
      expect(await profileRepo.findById(client, 'x', TENANT_ID)).toBeNull()
    })
  })

  describe('upsertProfile', () => {
    it('upserts with tenant columns', async () => {
      const profile = { id: USER_ID, name: 'Ana', email: 'ana@yoga.com', tenant_id: TENANT_ID }
      const client = makeClient([profile])
      const result = await profileRepo.upsertProfile(client, {
        id: USER_ID, name: 'Ana', email: 'ana@yoga.com', role: 'alumno',
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(profile)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE')
      expect(sql).toContain('tenant_id')
      expect(params).toContain(TENANT_ID)
    })
  })

  describe('updateProfile', () => {
    it('builds dynamic SET clause for provided fields', async () => {
      const updated = { id: USER_ID, name: 'Updated' }
      const client = makeClient([updated])
      const result = await profileRepo.updateProfile(client, USER_ID, TENANT_ID, { name: 'Updated', phone: '123456789' })
      expect(result).toEqual(updated)
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain('name = $')
      expect(sql).toContain('phone = $')
      expect(sql).toContain('WHERE id = $')
      expect(sql).toContain('tenant_id = $')
    })

    it('returns null when profile not found', async () => {
      const client = makeClient([])
      const result = await profileRepo.updateProfile(client, 'x', TENANT_ID, { name: 'X' })
      expect(result).toBeNull()
    })
  })

  describe('searchProfiles', () => {
    it('queries with tenant and optional search term', async () => {
      const client = makeClient([{ id: USER_ID, name: 'Ana' }])
      const result = await profileRepo.searchProfiles(client, TENANT_ID, { search: 'ana', limit: 10, offset: 0 })
      expect(result).toHaveLength(1)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('ILIKE')
      expect(params).toContain(TENANT_ID)
      expect(params).toContain('%ana%')
    })

    it('passes null when no search term', async () => {
      const client = makeClient([])
      await profileRepo.searchProfiles(client, TENANT_ID, {})
      expect(client.query.mock.calls[0][1]).toContain(null)
    })
  })

  describe('getHistory', () => {
    it('returns class history ordered by attended_at DESC', async () => {
      const rows = [{ booking_id: 'b1', class_name: 'Hatha' }]
      const client = makeClient(rows)
      const result = await profileRepo.getHistory(client, USER_ID, TENANT_ID)
      expect(result).toEqual(rows)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('ORDER BY attended_at DESC')
      expect(params).toEqual([USER_ID, TENANT_ID])
    })
  })

  describe('addHistory', () => {
    it('inserts history with ON CONFLICT DO NOTHING', async () => {
      const client = makeClient([])
      await profileRepo.addHistory(client, {
        userId: USER_ID, bookingId: 'b1', className: 'Hatha',
        instructor: 'Maria', attendedAt: new Date(), tenantId: TENANT_ID, subTenantId: null,
      })
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain('ON CONFLICT (booking_id) DO NOTHING')
      expect(sql).toContain('tenant_id')
    })
  })
})
