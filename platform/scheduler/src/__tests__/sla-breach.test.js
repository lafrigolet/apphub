// dispute-sla.job — flagea disputes 'open' sin respuesta vendor > 48h.
// Contrato:
//   - meta.cron === '*/30 * * * *'.
//   - SQL es un CTE con stale (UPDATE FROM) → SET sla_breached_at = now().
//     Re-ejecuciones: el filtro sla_breached_at IS NULL evita refire.
//   - $1 = SLA_HOURS = 48 (string castea a interval).
//   - Publica 'dispute.sla_breached' por cada row devuelta.
//   - logger.info SOLO cuando rows.length > 0.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as job from '../jobs/dispute-sla.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

beforeEach(() => vi.clearAllMocks())

// ── meta ────────────────────────────────────────────────────────────

describe('meta', () => {
  it('cron = "*/30 * * * *" (cada 30 min)', () => {
    expect(job.meta.cron).toBe('*/30 * * * *')
  })
  it('name = "dispute-sla" (usado como advisory-lock key)', () => {
    expect(job.meta.name).toBe('dispute-sla')
  })
})

// ── SQL shape ───────────────────────────────────────────────────────

describe('SQL shape', () => {
  it('parametriza SLA_HOURS=48 (no concatenado al SQL)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await job.run({ db, publish: vi.fn(), logger: mkLogger() })
    expect(db.query.mock.calls[0][1]).toEqual(['48'])
  })

  it('filtra status=\'open\' + sla_breached_at IS NULL (evita refire en 2ª tick)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await job.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/d\.status = 'open'/)
    expect(sql).toMatch(/d\.sla_breached_at IS NULL/)
  })

  it('NOT EXISTS sobre dispute_messages con sender_role=\'vendor\' (anti-acordados sin replies)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await job.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/NOT EXISTS/)
    expect(sql).toMatch(/sender_role = 'vendor'/)
  })

  it('UPDATE … SET sla_breached_at = now() (stamp en la misma query → idempotent)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await job.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/UPDATE platform_disputes\.disputes/)
    expect(sql).toMatch(/SET sla_breached_at = now\(\)/)
  })

  it('cast a interval con sufijo "hours" → 48 horas', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await job.run({ db, publish: vi.fn(), logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/'\s*hours'\)::interval/)
  })
})

// ── publish event ───────────────────────────────────────────────────

describe('publish dispute.sla_breached', () => {
  it('1 row → 1 publish con payload completo', async () => {
    const row = {
      id: 'disp-1', app_id: 'shop', tenant_id: 't1',
      order_id: 'ord-1', buyer_user_id: 'buy-1',
      created_at: '2026-05-19T08:00:00Z',
    }
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) }
    const publish = vi.fn()
    const r = await job.run({ db, publish, logger: mkLogger() })

    expect(publish).toHaveBeenCalledWith({
      type: 'dispute.sla_breached',
      payload: {
        appId: 'shop', tenantId: 't1',
        disputeId: 'disp-1', orderId: 'ord-1', buyerUserId: 'buy-1',
        openedAt: '2026-05-19T08:00:00Z', slaHours: 48,
      },
    })
    expect(r.rowsAffected).toBe(1)
  })

  it('N rows → N publish (uno por dispute)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`, app_id: 'shop', tenant_id: 't1',
      order_id: `o${i}`, buyer_user_id: `u${i}`, created_at: '2026-05-19T08:00:00Z',
    }))
    const db = { query: vi.fn().mockResolvedValue({ rows }) }
    const publish = vi.fn()
    const r = await job.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledTimes(5)
    expect(r.rowsAffected).toBe(5)
  })

  it('0 rows → 0 publish, no log.info (ruido en idle ticks)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const logger = mkLogger()
    const r = await job.run({ db, publish, logger })
    expect(publish).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })

  it('rows > 0 → log.info con count (para detectar spikes en logs)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'd1', app_id: 'a', tenant_id: 't', order_id: 'o', buyer_user_id: 'u', created_at: 'x' }] }) }
    const logger = mkLogger()
    await job.run({ db, publish: vi.fn(), logger })
    expect(logger.info).toHaveBeenCalledWith({ count: 1 }, expect.stringContaining('SLA-breached'))
  })
})
