// Tests for the wave-2 jobs:
//   Block A: scheduler-runs-purge (own-schema retention)
//   Block B: auth-token-purge, notification-send-log-purge, messaging-sla,
//            telehealth-expire-stale
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    SCHEDULER_RUNS_RETENTION_DAYS: 90,
    NOTIFICATIONS_SEND_LOG_RETENTION_DAYS: 90,
    MESSAGING_SLA_HOURS: 24,
  },
}))

import * as runsPurge from '../jobs/scheduler-runs-purge.job.js'
import * as authTokenPurge from '../jobs/auth-token-purge.job.js'
import * as sendLogPurge from '../jobs/notification-send-log-purge.job.js'
import * as messagingSla from '../jobs/messaging-sla.job.js'
import * as telehealthExpire from '../jobs/telehealth-expire-stale.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('scheduler-runs-purge', () => {
  it('borra runs pasada la ventana de retención y reporta rowsAffected', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 4 }) }
    const r = await runsPurge.run({ db, logger: mkLogger() })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_scheduler\.runs/)
    expect(sql).toMatch(/started_at < now\(\) - \(\$1 \|\| ' days'\)::interval/)
    expect(params).toEqual([90])
    expect(r.rowsAffected).toBe(4)
  })

  it('meta declara cron diario a las 04:00', () => {
    expect(runsPurge.meta.name).toBe('scheduler-runs-purge')
    expect(runsPurge.meta.cron).toBe('0 4 * * *')
  })
})

describe('auth-token-purge', () => {
  it('borra de password_resets, magic_links y activation_tokens WHERE expires_at < now()', async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 3 }) }
    const r = await authTokenPurge.run({ db, logger: mkLogger() })
    expect(db.query).toHaveBeenCalledTimes(3)
    expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_auth\.password_resets WHERE expires_at < now\(\)/)
    expect(db.query.mock.calls[1][0]).toMatch(/DELETE FROM platform_auth\.magic_links WHERE expires_at < now\(\)/)
    expect(db.query.mock.calls[2][0]).toMatch(/DELETE FROM platform_auth\.activation_tokens WHERE expires_at < now\(\)/)
    expect(r.rowsAffected).toBe(6)
  })

  it('meta declara cron 30 3 * * *', () => {
    expect(authTokenPurge.meta.name).toBe('auth-token-purge')
    expect(authTokenPurge.meta.cron).toBe('30 3 * * *')
  })
})

describe('notification-send-log-purge', () => {
  it('borra send_log por retención usando el parámetro de env', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 7 }) }
    const r = await sendLogPurge.run({ db, logger: mkLogger() })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_notifications\.send_log/)
    expect(sql).toMatch(/sent_at < now\(\) - \(\$1 \|\| ' days'\)::interval/)
    expect(params).toEqual([90])
    expect(r.rowsAffected).toBe(7)
  })

  it('meta declara cron 0 5 * * *', () => {
    expect(sendLogPurge.meta.cron).toBe('0 5 * * *')
  })
})

describe('messaging-sla', () => {
  it('selecciona threads en la ventana y publica messaging.vendor.sla_breached por fila', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { id: 'th1', app_id: 'a', tenant_id: 't', buyer_user_id: 'b', vendor_user_id: 'v', order_id: 'o', created_at: 'x' },
    ] }) }
    const publish = vi.fn().mockResolvedValue()
    const r = await messagingSla.run({ db, publish, logger: mkLogger() })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_messaging\.threads/)
    expect(sql).toMatch(/first_reply_at IS NULL/)
    expect(sql).toMatch(/status = 'open'/)
    // window pattern: created_at within (now-SLA-window, now-SLA]
    expect(sql).toMatch(/created_at <= now\(\) - \(\$1 \|\| ' hours'\)::interval/)
    expect(sql).toMatch(/created_at >  now\(\) - \(\$1 \|\| ' hours'\)::interval - \(\$2 \|\| ' minutes'\)::interval/)
    expect(params).toEqual(['24', '15'])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'messaging.vendor.sla_breached',
      payload: expect.objectContaining({ threadId: 'th1', vendorUserId: 'v', slaHours: 24 }),
    }))
    expect(r.rowsAffected).toBe(1)
  })

  it('sin filas → no publica', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const r = await messagingSla.run({ db, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })

  it('meta declara cron */15 * * * *', () => {
    expect(messagingSla.meta.cron).toBe('*/15 * * * *')
  })
})

describe('telehealth-expire-stale', () => {
  it('flipea salas stale a expired y publica telehealth.room.expired por sala', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { id: 'r1', app_id: 'a', tenant_id: 't', booking_id: 'bk1' },
      { id: 'r2', app_id: 'a', tenant_id: 't', booking_id: null },
    ] }) }
    const publish = vi.fn().mockResolvedValue()
    const r = await telehealthExpire.run({ db, publish, logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/UPDATE platform_telehealth\.rooms/)
    expect(sql).toMatch(/SET status = 'expired', updated_at = now\(\)/)
    expect(sql).toMatch(/status IN \('created', 'active'\)/)
    expect(sql).toMatch(/expires_at < now\(\)/)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'telehealth.room.expired',
      payload: expect.objectContaining({ roomId: 'r1', bookingId: 'bk1' }),
    }))
    expect(r.rowsAffected).toBe(2)
  })

  it('meta declara cron cada minuto', () => {
    expect(telehealthExpire.meta.cron).toBe('* * * * *')
  })
})
