// lead-followup-due + lead-sla — jobs del pipeline de leads (patrón ventana,
// solo SELECT sobre platform_leads). Contrato:
//   - WINDOW pattern: next_follow_up_at / created_at / touched_at cruzando la
//     ventana del último tick → se emite exactamente una vez.
//   - Sin UPDATE: el scheduler no tiene columna sentinel que sellar.
//   - logger.info SOLO cuando hay filas.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { LEADS_NEW_SLA_HOURS: 24, LEADS_STALE_DAYS: 7 },
}))

import * as followup from '../jobs/lead-followup-due.job.js'
import * as sla from '../jobs/lead-sla.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

beforeEach(() => vi.clearAllMocks())

describe('lead-followup-due', () => {
  it('meta: cron */15, name = lead-followup-due', () => {
    expect(followup.meta.cron).toBe('*/15 * * * *')
    expect(followup.meta.name).toBe('lead-followup-due')
  })

  it('SQL: ventana sobre next_follow_up_at + solo estados abiertos, sin UPDATE', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await followup.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/next_follow_up_at <= now\(\)/)
    expect(sql).toMatch(/next_follow_up_at >\s+now\(\) - \(\$1 \|\| ' minutes'\)::interval/)
    expect(sql).toMatch(/status IN \('new', 'contacted', 'qualified'\)/)
    expect(sql).not.toMatch(/UPDATE/)
    expect(db.query.mock.calls[0][1]).toEqual(['15'])
  })

  it('emite lead.followup.due por fila con payload', async () => {
    const row = { id: 'l1', app_id: 'aikikan', assigned_to: 'u1', status: 'contacted', next_follow_up_at: '2026-06-12T10:00:00Z' }
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) }
    const publish = vi.fn()
    await followup.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith({
      type: 'lead.followup.due',
      payload: { appId: 'aikikan', leadId: 'l1', assignedTo: 'u1', status: 'contacted', nextFollowUpAt: '2026-06-12T10:00:00Z' },
    })
  })

  it('0 filas → 0 publish, sin log.info', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn(); const logger = mkLogger()
    const r = await followup.run({ db, publish, logger })
    expect(publish).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })
})

describe('lead-sla', () => {
  it('meta: cron */30, name = lead-sla', () => {
    expect(sla.meta.cron).toBe('*/30 * * * *')
    expect(sla.meta.name).toBe('lead-sla')
  })

  it('query 1: leads new cruzando el SLA de contacto (ventana, parametrizado)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await sla.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toMatch(/status = 'new'/)
    expect(sql).toMatch(/created_at <= now\(\) - \(\$1 \|\| ' hours'\)::interval/)
    expect(db.query.mock.calls[0][1]).toEqual(['24', '30']) // SLA_HOURS default + WINDOW
  })

  it('query 2: estancados por greatest(updated_at, última actividad, created_at)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await sla.run({ db, publish: vi.fn(), logger: mkLogger() })
    const sql = db.query.mock.calls[1][0]
    expect(sql).toMatch(/greatest\(/)
    expect(sql).toMatch(/max\(a\.created_at\)/)
    expect(sql).toMatch(/touched_at <= now\(\) - \(\$1 \|\| ' days'\)::interval/)
    expect(db.query.mock.calls[1][1]).toEqual(['7', '30']) // STALE_DAYS default + WINDOW
  })

  it('emite lead.sla.uncontacted y lead.stale; rowsAffected = suma', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'l1', app_id: 'a', assigned_to: 'u1', created_at: 'c1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l2', app_id: 'a', assigned_to: null, status: 'qualified', touched_at: 't2' }] }),
    }
    const publish = vi.fn()
    const r = await sla.run({ db, publish, logger: mkLogger() })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'lead.sla.uncontacted', payload: expect.objectContaining({ leadId: 'l1', slaHours: 24 }) }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'lead.stale', payload: expect.objectContaining({ leadId: 'l2', staleDays: 7 }) }))
    expect(r.rowsAffected).toBe(2)
  })

  it('0 filas en ambas → sin log.info', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const logger = mkLogger()
    await sla.run({ db, publish: vi.fn(), logger })
    expect(logger.info).not.toHaveBeenCalled()
  })
})
