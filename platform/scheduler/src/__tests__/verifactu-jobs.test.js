import { describe, it, expect, vi } from 'vitest'
import * as remisionRetry from '../jobs/verifactu-remision-retry.job.js'
import * as dlqAlert from '../jobs/verifactu-dlq-alert.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('verifactu-remision-retry', () => {
  it('publica verifactu.remision.due por tenant con trabajo (cola + altas sin encolar)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { app_id: 'tpv', tenant_id: 't1', sub_tenant_id: null },
      { app_id: 'aikikan', tenant_id: 't2', sub_tenant_id: 's2' },
    ] }) }
    const publish = vi.fn()
    const r = await remisionRetry.run({ db, publish, logger: mkLogger() })
    // un único SELECT (UNION cola+registros)
    expect(db.query).toHaveBeenCalledTimes(1)
    expect(db.query.mock.calls[0][0]).toMatch(/remision_queue[\s\S]*UNION[\s\S]*registros/)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'verifactu.remision.due',
      payload: { appId: 'aikikan', tenantId: 't2', subTenantId: 's2' },
    }))
    expect(r.rowsAffected).toBe(2)
  })

  it('sin trabajo → 0 sin publicar', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const publish = vi.fn()
    const r = await remisionRetry.run({ db, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
    expect(r.rowsAffected).toBe(0)
  })
})

describe('verifactu-dlq-alert', () => {
  it('publica verifactu.remision.dlq_alert con el recuento por tenant', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ app_id: 'tpv', tenant_id: 't1', n: 3 }] }) }
    const publish = vi.fn()
    const r = await dlqAlert.run({ db, publish, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/estado = 'dlq'/)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'verifactu.remision.dlq_alert',
      payload: { appId: 'tpv', tenantId: 't1', enDlq: 3 },
    }))
    expect(r.rowsAffected).toBe(1)
  })
})
