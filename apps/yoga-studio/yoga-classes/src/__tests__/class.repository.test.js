import { describe, it, expect, vi } from 'vitest'
import * as classRepo from '../repositories/class.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const CLASS_ID = '33333333-3333-3333-3333-333333333333'
const SESSION_ID = '44444444-4444-4444-4444-444444444444'
const INSTRUCTOR_ID = '22222222-2222-2222-2222-222222222222'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

const classData = {
  id: CLASS_ID, name: 'Hatha Flow', type: 'hatha', instructorId: INSTRUCTOR_ID,
  room: 'Sala 1', startTime: '09:00', durationMin: 60, maxCapacity: 12,
  level: 'todos', tenantId: TENANT_ID, subTenantId: null,
}

describe('class.repository', () => {
  describe('listClasses', () => {
    it('filters by tenant_id and active status', async () => {
      const client = makeClient([{ id: CLASS_ID, name: 'Hatha Flow' }])
      const result = await classRepo.listClasses(client, TENANT_ID)
      expect(result).toHaveLength(1)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('c.tenant_id = $1')
      expect(sql).toContain('c.is_active = true')
      expect(params[0]).toBe(TENANT_ID)
    })

    it('adds type filter when provided', async () => {
      const client = makeClient([])
      await classRepo.listClasses(client, TENANT_ID, { type: 'hatha' })
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('c.type = $')
      expect(params).toContain('hatha')
    })

    it('adds level filter when provided', async () => {
      const client = makeClient([])
      await classRepo.listClasses(client, TENANT_ID, { level: 'principiante' })
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('c.level = $')
      expect(params).toContain('principiante')
    })
  })

  describe('findById', () => {
    it('returns class scoped to tenant', async () => {
      const cls = { id: CLASS_ID, name: 'Hatha', tenant_id: TENANT_ID }
      const client = makeClient([cls])
      const result = await classRepo.findById(client, CLASS_ID, TENANT_ID)
      expect(result).toEqual(cls)
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
        [CLASS_ID, TENANT_ID],
      )
    })

    it('returns null when not found', async () => {
      expect(await classRepo.findById(makeClient([]), 'x', TENANT_ID)).toBeNull()
    })
  })

  describe('createClass', () => {
    it('inserts class with all fields including tenant columns', async () => {
      const inserted = { id: CLASS_ID, ...classData }
      const client = makeClient([inserted])
      const result = await classRepo.createClass(client, classData)
      expect(result).toEqual(inserted)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('tenant_id')
      expect(sql).toContain('sub_tenant_id')
      expect(params).toContain(TENANT_ID)
    })
  })

  describe('updateClass', () => {
    it('builds dynamic SET for provided fields', async () => {
      const updated = { id: CLASS_ID, name: 'New Name', tenant_id: TENANT_ID }
      const client = makeClient([updated])
      const result = await classRepo.updateClass(client, CLASS_ID, TENANT_ID, { name: 'New Name' })
      expect(result).toEqual(updated)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('name = $')
      expect(sql).toContain('tenant_id = $')
      expect(params).toContain('New Name')
    })

    it('returns null when class not found', async () => {
      const client = makeClient([])
      const result = await classRepo.updateClass(client, 'x', TENANT_ID, { name: 'X' })
      expect(result).toBeNull()
    })
  })

  describe('deactivateClass', () => {
    it('sets is_active to false scoped to tenant', async () => {
      const client = makeClient([])
      await classRepo.deactivateClass(client, CLASS_ID, TENANT_ID)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('is_active = false')
      expect(params).toEqual([CLASS_ID, TENANT_ID])
    })
  })

  describe('findSession', () => {
    it('joins sessions with classes and scopes to tenant', async () => {
      const session = { id: SESSION_ID, class_id: CLASS_ID, max_capacity: 12 }
      const client = makeClient([session])
      const result = await classRepo.findSession(client, SESSION_ID, TENANT_ID)
      expect(result).toEqual(session)
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain('JOIN yoga_classes.classes')
    })

    it('returns null when session not found', async () => {
      expect(await classRepo.findSession(makeClient([]), 'x', TENANT_ID)).toBeNull()
    })
  })

  describe('incrementSpots', () => {
    it('increments spots_taken by delta and returns result', async () => {
      const row = { spots_taken: 5, max_capacity: 12 }
      const client = makeClient([row])
      const result = await classRepo.incrementSpots(client, SESSION_ID, TENANT_ID, 1)
      expect(result).toEqual(row)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('spots_taken = spots_taken + $2')
      expect(params).toEqual([SESSION_ID, 1, TENANT_ID])
    })
  })

  describe('getInstructorSessions', () => {
    it('returns upcoming sessions for instructor scoped to tenant', async () => {
      const rows = [{ id: SESSION_ID, date: '2026-05-01' }]
      const client = makeClient(rows)
      const result = await classRepo.getInstructorSessions(client, INSTRUCTOR_ID, TENANT_ID)
      expect(result).toEqual(rows)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('c.instructor_id = $1')
      expect(sql).toContain('c.tenant_id = $2')
      expect(sql).toContain('s.date >= CURRENT_DATE')
      expect(params).toEqual([INSTRUCTOR_ID, TENANT_ID])
    })
  })
})
