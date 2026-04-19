import { describe, it, expect, vi } from 'vitest'
import * as bookingRepo from '../repositories/booking.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const BOOKING_ID = '55555555-5555-5555-5555-555555555555'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const SESSION_ID = '44444444-4444-4444-4444-444444444444'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

const booking = {
  id: BOOKING_ID, user_id: USER_ID, session_id: SESSION_ID,
  status: 'confirmed', tenant_id: TENANT_ID, sub_tenant_id: null,
}

describe('booking.repository', () => {
  describe('createBooking', () => {
    it('inserts booking with tenant columns and confirmed status', async () => {
      const client = makeClient([booking])
      const result = await bookingRepo.createBooking(client, {
        id: BOOKING_ID, userId: USER_ID, sessionId: SESSION_ID,
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(booking)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain("'confirmed'")
      expect(sql).toContain('tenant_id')
      expect(params).toEqual([BOOKING_ID, USER_ID, SESSION_ID, TENANT_ID, null])
    })
  })

  describe('findById', () => {
    it('returns booking scoped to tenant', async () => {
      const client = makeClient([booking])
      const result = await bookingRepo.findById(client, BOOKING_ID, TENANT_ID)
      expect(result).toEqual(booking)
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
        [BOOKING_ID, TENANT_ID],
      )
    })

    it('returns null when not found', async () => {
      expect(await bookingRepo.findById(makeClient([]), 'x', TENANT_ID)).toBeNull()
    })
  })

  describe('listByUser', () => {
    it('returns all bookings for user ordered by date desc', async () => {
      const client = makeClient([booking])
      const result = await bookingRepo.listByUser(client, USER_ID, TENANT_ID)
      expect(result).toEqual([booking])
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('ORDER BY booked_at DESC')
      expect(params).toEqual([USER_ID, TENANT_ID])
    })
  })

  describe('cancelBooking', () => {
    it('sets status to cancelled for confirmed booking', async () => {
      const cancelled = { ...booking, status: 'cancelled' }
      const client = makeClient([cancelled])
      const result = await bookingRepo.cancelBooking(client, BOOKING_ID, TENANT_ID, 'personal reason')
      expect(result).toEqual(cancelled)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain("status = 'cancelled'")
      expect(sql).toContain("status = 'confirmed'")
      expect(params).toContain('personal reason')
    })

    it('returns null when booking not in confirmed state', async () => {
      const client = makeClient([])
      const result = await bookingRepo.cancelBooking(client, BOOKING_ID, TENANT_ID)
      expect(result).toBeNull()
    })
  })

  describe('markAttended', () => {
    it('sets status to attended for confirmed booking', async () => {
      const attended = { ...booking, status: 'attended' }
      const client = makeClient([attended])
      const result = await bookingRepo.markAttended(client, BOOKING_ID, TENANT_ID)
      expect(result).toEqual(attended)
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain("SET status = 'attended'")
      expect(sql).toContain("status = 'confirmed'")
    })

    it('returns null when booking not in confirmed state', async () => {
      expect(await bookingRepo.markAttended(makeClient([]), BOOKING_ID, TENANT_ID)).toBeNull()
    })
  })

  describe('markNoShow', () => {
    it('sets status to no_show without tenant scope (cron bypass)', async () => {
      const client = makeClient([])
      await bookingRepo.markNoShow(client, BOOKING_ID)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain("SET status = 'no_show'")
      expect(params).toContain(BOOKING_ID)
    })
  })

  describe('addToWaitlist', () => {
    it('inserts with ON CONFLICT DO NOTHING', async () => {
      const entry = { id: 'w1', user_id: USER_ID, session_id: SESSION_ID, position: 1 }
      const client = makeClient([entry])
      const result = await bookingRepo.addToWaitlist(client, {
        id: 'w1', userId: USER_ID, sessionId: SESSION_ID, position: 1,
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(entry)
      const [sql] = client.query.mock.calls[0]
      expect(sql).toContain('ON CONFLICT (user_id, session_id) DO NOTHING')
    })

    it('returns null when already on waitlist', async () => {
      const client = makeClient([])
      const result = await bookingRepo.addToWaitlist(client, {
        id: 'w1', userId: USER_ID, sessionId: SESSION_ID, position: 1,
        tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toBeNull()
    })
  })

  describe('nextInWaitlist', () => {
    it('returns first unnotified entry by position', async () => {
      const entry = { id: 'w1', user_id: USER_ID, position: 1, notified_at: null }
      const client = makeClient([entry])
      const result = await bookingRepo.nextInWaitlist(client, SESSION_ID, TENANT_ID)
      expect(result).toEqual(entry)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('notified_at IS NULL')
      expect(sql).toContain('ORDER BY position LIMIT 1')
      expect(params).toEqual([SESSION_ID, TENANT_ID])
    })
  })
})
