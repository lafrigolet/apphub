// storage-orphan-purge + storage-retention-purge jobs.
// Contrato:
//   storage-orphan-purge (hourly 0 * * * *):
//     - DELETE FROM platform_storage.objects status='pending' AND created_at < now()-1h.
//     - No publish (es housekeeping, no es un evento de negocio).
//     - log.info SOLO si rowCount > 0.
//
//   storage-retention-purge (daily 15 3 * * *):
//     - UPDATE status='uploaded' WHERE retention_until IS NOT NULL AND retention_until <= now()
//       → set status='deleted', deleted_at=now(), RETURNING …
//     - Publica 'storage.object.deleted' por cada row con reason='retention_expired'.
//     - log.info SOLO si rows.length > 0.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as orphan from '../jobs/storage-orphan-purge.job.js'
import * as retention from '../jobs/storage-retention-purge.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

beforeEach(() => vi.clearAllMocks())

// ── orphan-purge ────────────────────────────────────────────────────

describe('storage-orphan-purge', () => {
  it('meta cron = "0 * * * *" (hourly)', () => {
    expect(orphan.meta.cron).toBe('0 * * * *')
  })

  it('SQL: DELETE status=\'pending\' + created_at < now()-1h', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    await orphan.run({ db, logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/DELETE FROM platform_storage\.objects/)
    expect(sql).toMatch(/status = 'pending'/)
    expect(sql).toMatch(/created_at < now\(\) - interval '1 hour'/)
  })

  it('rowCount=0 → NO log.info (silencio en idle)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    const logger = mkLogger()
    const r = await orphan.run({ db, logger })
    expect(r.rowsAffected).toBe(0)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('rowCount>0 → log.info con rowCount', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 7 }) }
    const logger = mkLogger()
    const r = await orphan.run({ db, logger })
    expect(r.rowsAffected).toBe(7)
    expect(logger.info).toHaveBeenCalledWith({ rowCount: 7 }, expect.stringContaining('orphan'))
  })
})

// ── retention-purge ─────────────────────────────────────────────────

describe('storage-retention-purge', () => {
  it('meta cron = "15 3 * * *" (daily 03:15)', () => {
    expect(retention.meta.cron).toBe('15 3 * * *')
  })

  it('SQL: UPDATE status="deleted" + deleted_at=now() WHERE retention vencida', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await retention.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/UPDATE platform_storage\.objects/)
    expect(sql).toMatch(/SET status = 'deleted', deleted_at = now\(\)/)
    expect(sql).toMatch(/status = 'uploaded'/)
    expect(sql).toMatch(/retention_until IS NOT NULL/)
    expect(sql).toMatch(/retention_until <= now\(\)/)
    expect(sql).toMatch(/RETURNING/)
  })

  it('0 rows → 0 publish, no log.info', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const logger = mkLogger()
    const r = await retention.run({ db, publish, logger })
    expect(r.rowsAffected).toBe(0)
    expect(publish).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('1 row → 1 publish storage.object.deleted con reason="retention_expired"', async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rows: [{ id: 'obj-1', app_id: 'a', tenant_id: 't', kind: 'invoice', bucket: 'b', key: 'k' }],
    }) }
    const publish = vi.fn()
    const r = await retention.run({ db, publish, logger: mkLogger() })
    expect(r.rowsAffected).toBe(1)
    expect(publish).toHaveBeenCalledWith({
      type: 'storage.object.deleted',
      payload: {
        appId: 'a', tenantId: 't', objectId: 'obj-1', kind: 'invoice',
        reason: 'retention_expired',
      },
    })
  })

  it('N rows → N publish (uno por object)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `o${i}`, app_id: 'a', tenant_id: 't', kind: 'signature', bucket: 'b', key: `k${i}`,
    }))
    const db = { query: vi.fn().mockResolvedValue({ rows }) }
    const publish = vi.fn()
    await retention.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledTimes(5)
  })

  it('payload publicado NO incluye bucket/key (irrelevantes para consumers)', async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rows: [{ id: 'o1', app_id: 'a', tenant_id: 't', kind: 'invoice', bucket: 'private-bucket', key: 'secrets/path' }],
    }) }
    const publish = vi.fn()
    await retention.run({ db, publish, logger: mkLogger() })
    const payload = publish.mock.calls[0][0].payload
    expect(payload).not.toHaveProperty('bucket')
    expect(payload).not.toHaveProperty('key')
  })
})
