import { describe, it, expect, vi } from 'vitest'
import * as reportRepo from '../repositories/reporting.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BOOKING_ID = '55555555-5555-5555-5555-555555555555'
const INSTRUCTOR_ID = '22222222-2222-2222-2222-222222222222'
const RATING_ID = '99999999-9999-9999-9999-999999999999'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

describe('reporting.repository', () => {
  describe('getDashboard', () => {
    it('queries 30-day rolling aggregate scoped to tenant', async () => {
      const metrics = { total_bookings: 150, total_attended: 130, total_no_show: 10, active_users: 45 }
      const client = makeClient([metrics])
      const result = await reportRepo.getDashboard(client, TENANT_ID)
      expect(result).toEqual(metrics)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('INTERVAL \'30 days\'')
      expect(sql).toContain('tenant_id = $1')
      expect(params).toEqual([TENANT_ID])
    })
  })

  describe('getAttendance', () => {
    it('returns daily metrics with optional date range', async () => {
      const rows = [{ date: '2026-04-18', total_bookings: 5 }]
      const client = makeClient(rows)
      const result = await reportRepo.getAttendance(client, TENANT_ID, { from: '2026-04-01', to: '2026-04-30' })
      expect(result).toEqual(rows)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('m.tenant_id = $1')
      expect(sql).toContain('m.date >= $')
      expect(sql).toContain('m.date <= $')
      expect(params).toContain('2026-04-01')
      expect(params).toContain('2026-04-30')
    })

    it('works without date filters', async () => {
      const client = makeClient([])
      await reportRepo.getAttendance(client, TENANT_ID, {})
      const [sql, params] = client.query.mock.calls[0]
      expect(params).toEqual([TENANT_ID])
      expect(sql).not.toContain('date >=')
    })
  })

  describe('upsertDailyMetric', () => {
    it('upserts with tenant+date PK and increments field', async () => {
      const client = makeClient([])
      await reportRepo.upsertDailyMetric(client, TENANT_ID, '2026-04-18', 'total_bookings', 1)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('ON CONFLICT (tenant_id, date) DO UPDATE')
      expect(sql).toContain('total_bookings')
      expect(params).toEqual([TENANT_ID, '2026-04-18', 1])
    })

    it('decrements when delta is negative', async () => {
      const client = makeClient([])
      await reportRepo.upsertDailyMetric(client, TENANT_ID, '2026-04-18', 'total_bookings', -1)
      const [, params] = client.query.mock.calls[0]
      expect(params[2]).toBe(-1)
    })
  })

  describe('createRating', () => {
    it('inserts rating with ON CONFLICT DO NOTHING for idempotency', async () => {
      const rating = { id: RATING_ID, booking_id: BOOKING_ID, stars: 5 }
      const client = makeClient([rating])
      const result = await reportRepo.createRating(client, {
        id: RATING_ID, bookingId: BOOKING_ID, userId: USER_ID,
        classId: null, instructorId: INSTRUCTOR_ID, stars: 5, comment: 'Great!',
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(rating)
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain('ON CONFLICT (booking_id) DO NOTHING')
      expect(sql).toContain('tenant_id')
    })

    it('returns null on duplicate booking_id (idempotent)', async () => {
      const client = makeClient([])
      const result = await reportRepo.createRating(client, {
        id: RATING_ID, bookingId: BOOKING_ID, userId: USER_ID,
        stars: 4, tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toBeNull()
    })
  })

  describe('getInstructorRatings', () => {
    it('returns summary with recent ratings', async () => {
      const summary = { avg_rating: 4.5, total_ratings: 20, recent_ratings: [] }
      const client = makeClient([summary])
      const result = await reportRepo.getInstructorRatings(client, INSTRUCTOR_ID, TENANT_ID)
      expect(result).toEqual(summary)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('s.instructor_id = $1')
      expect(sql).toContain('s.tenant_id = $2')
      expect(params).toEqual([INSTRUCTOR_ID, TENANT_ID])
    })

    it('returns default empty object when instructor has no ratings', async () => {
      const client = makeClient([])
      const result = await reportRepo.getInstructorRatings(client, INSTRUCTOR_ID, TENANT_ID)
      expect(result).toEqual({ avg_rating: null, total_ratings: 0, recent_ratings: [] })
    })
  })

  describe('upsertInstructorSummary', () => {
    it('upserts instructor summary aggregated from ratings', async () => {
      const client = makeClient([])
      await reportRepo.upsertInstructorSummary(client, INSTRUCTOR_ID, TENANT_ID)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('AVG(stars)')
      expect(sql).toContain('ON CONFLICT (instructor_id) DO UPDATE')
      expect(params).toEqual([INSTRUCTOR_ID, TENANT_ID])
    })
  })
})
