// notifications-inbound-purge — publishes the purge_due event with the
// effective retention (config row overrides env default). No direct S3/DB
// deletes here: the notifications module owns the destructive work.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NOTIFICATIONS_INBOUND_RETENTION_DAYS: 365 },
}))

import * as job from '../jobs/notifications-inbound-purge.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('notifications-inbound-purge', () => {
  it('publishes purge_due with the env default when no config row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const r = await job.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith({
      type: 'notifications.inbound.purge_due',
      payload: { retentionDays: 365 },
    })
    expect(r.metadata.retentionDays).toBe(365)
  })

  it('config row inbound_retention_days overrides the env default', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ plain_value: '90' }] }) }
    const publish = vi.fn()
    await job.run({ db, publish, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/platform_notifications\.config/)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: { retentionDays: 90 },
    }))
  })

  it('garbage config value falls back to env', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ plain_value: 'not-a-number' }] }) }
    const publish = vi.fn()
    await job.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: { retentionDays: 365 },
    }))
  })

  it('meta declares the daily cron', () => {
    expect(job.meta.name).toBe('notifications-inbound-purge')
    expect(job.meta.cron).toBe('15 5 * * *')
  })
})
