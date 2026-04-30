import { describe, it, expect, vi } from 'vitest'

// All jobs share the same shape: pure function `run({db, redis, publish, logger})`
// that emits SQL via db.query and Redis events via publish. We mock both and
// assert the SQL fragments + event payloads.

import * as holdPurge          from '../jobs/availability-hold-purge.job.js'
import * as bookingReminders   from '../jobs/booking-reminders.job.js'
import * as reservationReminders from '../jobs/reservation-reminders.job.js'
import * as packageWarning     from '../jobs/package-expiry-warning.job.js'
import * as packageTransition  from '../jobs/package-expiry-transition.job.js'
import * as payoutClose        from '../jobs/practitioner-payout-close.job.js'
import * as disputeSla         from '../jobs/dispute-sla.job.js'
import * as basketAbandoned    from '../jobs/basket-abandoned.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

// ── availability-hold-purge ────────────────────────────────────────────
describe('availability-hold-purge', () => {
  it('issues a single DELETE and reports rowsAffected', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 3 }) }
    const r  = await holdPurge.run({ db, logger: mkLogger() })
    expect(db.query).toHaveBeenCalledTimes(1)
    expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_availability\.holds/)
    expect(r.rowsAffected).toBe(3)
  })
})

// ── booking-reminders ──────────────────────────────────────────────────
describe('booking-reminders', () => {
  it('iterates the two windows and publishes booking.reminder.due per row', async () => {
    const db = { query: vi.fn().mockImplementation(() => Promise.resolve({
      rows: [{
        id: 'b1', app_id: 'a', tenant_id: 't', service_id: 's',
        client_user_id: 'u', client_email: 'x@y.com', client_phone: '+34',
        client_name: 'Ana', starts_at: '2026-05-01T10:00:00Z', ends_at: '2026-05-01T10:30:00Z',
      }],
    })) }
    const publish = vi.fn().mockResolvedValue()
    const r = await bookingReminders.run({ db, publish, logger: mkLogger() })
    // 2 windows × 1 row each
    expect(db.query).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(2)
    // Each call carries the window label.
    const labels = publish.mock.calls.map((c) => c[0].payload.window)
    expect(labels).toEqual(expect.arrayContaining(['t_minus_24h', 't_minus_2h']))
    expect(r.rowsAffected).toBe(2)
  })

  it('returns 0 when no rows match', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const r = await bookingReminders.run({ db, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })
})

// ── reservation-reminders ──────────────────────────────────────────────
describe('reservation-reminders', () => {
  it('publishes reservation.reminder.due with guest fields', async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rows: [{
        id: 'r1', app_id: 'a', tenant_id: 't',
        guest_user_id: 'u', guest_email: 'g@y.com', guest_phone: '+34', guest_name: 'Bob',
        party_size: 2, reserved_for: '2026-05-01T20:00:00Z', table_id: 'tab',
      }],
    }) }
    const publish = vi.fn()
    const r = await reservationReminders.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reservation.reminder.due',
      payload: expect.objectContaining({ reservationId: 'r1', guestEmail: 'g@y.com' }),
    }))
    expect(r.rowsAffected).toBe(2)
  })
})

// ── package-expiry-warning ─────────────────────────────────────────────
describe('package-expiry-warning', () => {
  it('publishes package.expiring with window label', async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rows: [{
        id: 'p1', app_id: 'a', tenant_id: 't', client_user_id: 'u', service_id: 's',
        remaining_sessions: 2, total_sessions: 10, expires_at: '2026-05-30T00:00:00Z',
      }],
    }) }
    const publish = vi.fn()
    await packageWarning.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'package.expiring',
      payload: expect.objectContaining({ packageId: 'p1', remainingSessions: 2 }),
    }))
  })
})

// ── package-expiry-transition ──────────────────────────────────────────
describe('package-expiry-transition', () => {
  it('flips status and publishes package.expired per row', async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rows: [{ id: 'p1', app_id: 'a', tenant_id: 't', client_user_id: 'u', service_id: 's', remaining_sessions: 0, expires_at: '2026-05-01' }],
    }) }
    const publish = vi.fn()
    const r = await packageTransition.run({ db, publish, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/UPDATE platform_packages\.purchased_packages.*SET status = 'expired'/s)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.expired' }))
    expect(r.rowsAffected).toBe(1)
  })
})

// ── practitioner-payout-close ──────────────────────────────────────────
describe('practitioner-payout-close', () => {
  it('publishes payout.period_due per due schedule and advances next_run_at', async () => {
    const calls = []
    const db = { query: vi.fn().mockImplementation((sql) => {
      calls.push(sql)
      if (sql.includes('FROM platform_practitioner_payouts.payout_schedules')) {
        return Promise.resolve({ rows: [
          { id: 's1', app_id: 'a', tenant_id: 't', practitioner_id: 'p', period: 'monthly', anchor_day: 1, last_closed_at: null },
        ] })
      }
      return Promise.resolve({ rows: [] })
    }) }
    const publish = vi.fn()
    const r = await payoutClose.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payout.period_due',
      payload: expect.objectContaining({ scheduleId: 's1', practitionerId: 'p', period: 'monthly' }),
    }))
    // The second query updates next_run_at.
    expect(calls.some((s) => /UPDATE platform_practitioner_payouts\.payout_schedules/.test(s))).toBe(true)
    expect(r.rowsAffected).toBe(1)
  })

  it('returns 0 when no schedules are due', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const r = await payoutClose.run({ db, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })
})

// ── dispute-sla ────────────────────────────────────────────────────────
describe('dispute-sla', () => {
  it('publishes dispute.sla_breached per row returned by the UPDATE', async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rows: [{ id: 'd1', app_id: 'a', tenant_id: 't', order_id: 'o', buyer_user_id: 'u', created_at: '2026-04-25T00:00:00Z' }],
    }) }
    const publish = vi.fn()
    const r = await disputeSla.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dispute.sla_breached',
      payload: expect.objectContaining({ disputeId: 'd1', slaHours: 48 }),
    }))
    expect(r.rowsAffected).toBe(1)
  })
})

// ── basket-abandoned ───────────────────────────────────────────────────
describe('basket-abandoned', () => {
  it('skips keys with idle < threshold or empty items', async () => {
    const redis = {
      scan:   vi.fn()
        .mockResolvedValueOnce(['0', ['basket:a:t:u1', 'basket:a:t:u2', 'basket:abandoned-emitted:zzz']]),
      object: vi.fn()
        .mockResolvedValueOnce(60)                          // u1 — too fresh
        .mockResolvedValueOnce(25 * 60 * 60),               // u2 — old enough
      get:    vi.fn().mockResolvedValueOnce(JSON.stringify({ items: [{ sku: 'X', qty: 1 }] })),
      set:    vi.fn().mockResolvedValueOnce('OK'),
    }
    const publish = vi.fn()
    const r = await basketAbandoned.run({ redis, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'basket.abandoned',
      payload: expect.objectContaining({ userId: 'u2', itemCount: 1 }),
    }))
    expect(r.rowsAffected).toBe(1)
  })

  it('suppresses already-emitted keys via the marker SET NX', async () => {
    const redis = {
      scan:   vi.fn().mockResolvedValueOnce(['0', ['basket:a:t:u1']]),
      object: vi.fn().mockResolvedValueOnce(25 * 60 * 60),
      get:    vi.fn().mockResolvedValueOnce(JSON.stringify({ items: [{}] })),
      set:    vi.fn().mockResolvedValueOnce(null),         // SET NX failed → suppressed
    }
    const publish = vi.fn()
    const r = await basketAbandoned.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })
})
