import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { LEADS_RETENTION_DAYS: 1095 },
}))

import * as leadRetentionPurge from '../jobs/lead-retention-purge.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('lead-retention-purge', () => {
  it('borra solo leads cerrados (won/lost/closed) pasada la ventana de retención', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 3 }) }
    const logger = mkLogger()
    const r = await leadRetentionPurge.run({ db, logger })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_leads\.leads/)
    expect(sql).toMatch(/status IN \('won', 'lost', 'closed'\)/)
    expect(sql).toMatch(/updated_at < now\(\) - \(\$1 \|\| ' days'\)::interval/)
    expect(params).toEqual([1095])
    expect(r.rowsAffected).toBe(3)
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ rowCount: 3, retentionDays: 1095 }),
      'leads purged by retention policy',
    )
  })

  it('sin filas → no loguea', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    const logger = mkLogger()
    const r = await leadRetentionPurge.run({ db, logger })
    expect(r.rowsAffected).toBe(0)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('meta declara cron diario', () => {
    expect(leadRetentionPurge.meta.name).toBe('lead-retention-purge')
    expect(leadRetentionPurge.meta.cron).toBe('45 4 * * *')
  })
})
