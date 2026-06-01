// Cobertura de jobs que el resto de tests no toca: el registry jobs/index.js,
// notification-digest, y las ramas weekly/biweekly de practitioner-payout-close.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    JOB_AVAILABILITY_HOLD_PURGE_ENABLED: true,
    JOB_BOOKING_REMINDERS_ENABLED: true,
    JOB_BOOKING_RECURRENCE_EXPANDER_ENABLED: false,
    JOB_RESERVATION_REMINDERS_ENABLED: true,
    JOB_PACKAGE_EXPIRY_WARNING_ENABLED: true,
    JOB_PACKAGE_EXPIRY_TRANSITION_ENABLED: true,
    JOB_PRACTITIONER_PAYOUT_CLOSE_ENABLED: true,
    JOB_DISPUTE_SLA_ENABLED: true,
    JOB_BASKET_ABANDONED_ENABLED: true,
    JOB_STORAGE_ORPHAN_PURGE_ENABLED: true,
    JOB_STORAGE_RETENTION_PURGE_ENABLED: true,
    JOB_NOTIFICATION_DIGEST_ENABLED: false,
  },
}))

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('jobs registry (jobs/index.js)', () => {
  it('expone los 12 jobs con meta/run/enabled, respetando los flags de env', async () => {
    const { jobs } = await import('../jobs/index.js')
    expect(jobs).toHaveLength(12)
    for (const j of jobs) {
      expect(typeof j.meta.name).toBe('string')
      expect(typeof j.meta.cron).toBe('string')
      expect(typeof j.run).toBe('function')
      expect(typeof j.enabled).toBe('boolean')
    }
    const byName = Object.fromEntries(jobs.map((j) => [j.meta.name, j.enabled]))
    expect(byName['booking-recurrence-expander']).toBe(false)
    expect(byName['notification-digest']).toBe(false)
    expect(byName['availability-hold-purge']).toBe(true)
  })
})

describe('notification-digest', () => {
  it('publica notifications.digest.flush y reporta rowsAffected 0', async () => {
    const digest = await import('../jobs/notification-digest.job.js')
    const publish = vi.fn().mockResolvedValue()
    const r = await digest.run({ publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith({ type: 'notifications.digest.flush', payload: {} })
    expect(r.rowsAffected).toBe(0)
    expect(digest.meta.name).toBe('notification-digest')
  })
})

describe('practitioner-payout-close — ramas weekly/biweekly', () => {
  async function runWithPeriod(period) {
    const payoutClose = await import('../jobs/practitioner-payout-close.job.js')
    const db = { query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('FROM platform_practitioner_payouts.payout_schedules')) {
        return Promise.resolve({ rows: [
          { id: 's1', app_id: 'a', tenant_id: 't', practitioner_id: 'p', period, anchor_day: 1, last_closed_at: null },
        ] })
      }
      return Promise.resolve({ rows: [] })
    }) }
    const publish = vi.fn()
    await payoutClose.run({ db, publish, logger: mkLogger() })
    return publish.mock.calls[0][0].payload
  }

  it('weekly → periodEnd - 7 días', async () => {
    const p = await runWithPeriod('weekly')
    const start = new Date(p.periodStart), end = new Date(p.periodEnd)
    expect((end - start) / (24 * 60 * 60 * 1000)).toBe(7)
  })

  it('biweekly → periodEnd - 14 días', async () => {
    const p = await runWithPeriod('biweekly')
    const start = new Date(p.periodStart), end = new Date(p.periodEnd)
    expect((end - start) / (24 * 60 * 60 * 1000)).toBe(14)
  })
})
