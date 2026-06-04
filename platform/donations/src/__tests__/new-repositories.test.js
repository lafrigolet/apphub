import { describe, it, expect, vi } from 'vitest'
import * as donorsRepo   from '../repositories/donors.repository.js'
import * as settingsRepo from '../repositories/tenant-settings.repository.js'
import * as certsRepo    from '../repositories/fiscal-certificates.repository.js'

function mockClient(rows = [], rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) }
}

describe('donors.repository.listUniqueDonors', () => {
  it('agrupa por COALESCE(nif,email), filtra status=paid, ordena por total desc', async () => {
    const c = mockClient([{ donor_key: 'x@x' }])
    await donorsRepo.listUniqueDonors(c, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/GROUP BY COALESCE\(donor_nif, donor_email\)/)
    expect(sql).toMatch(/status = 'paid'/)
    expect(sql).toMatch(/ORDER BY SUM\(amount_cents\) DESC/)
    expect(params).toEqual([200, 0])  // default limit/offset
  })

  it('aplica search sobre nombre/email/nif', async () => {
    const c = mockClient([])
    await donorsRepo.listUniqueDonors(c, { search: 'juan', limit: 5, offset: 10 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/donor_name ILIKE/)
    expect(params).toEqual(['%juan%', 5, 10])
  })

  it('aplica rango de fechas', async () => {
    const c = mockClient([])
    await donorsRepo.listUniqueDonors(c, { fromDate: '2026-01-01', toDate: '2026-12-31' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/paid_at >= /)
    expect(sql).toMatch(/paid_at <= /)
    expect(params).toEqual(['2026-01-01', '2026-12-31', 200, 0])
  })
})

describe('donors.repository.getDonorByKey', () => {
  it('null si no hay resumen', async () => {
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    expect(await donorsRepo.getDonorByKey(c, 'ghost')).toBeNull()
  })
  it('devuelve resumen + historial cuando existe', async () => {
    const c = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ donor_key: 'a@b', total_cents: 5000 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'd1' }, { id: 'd2' }] }),
    }
    const r = await donorsRepo.getDonorByKey(c, 'a@b')
    expect(r.donor_key).toBe('a@b')
    expect(r.donations).toHaveLength(2)
  })
})

describe('tenant-settings.repository', () => {
  it('find usa IS NOT DISTINCT FROM para sub_tenant_id nullable', async () => {
    const c = mockClient([{ id: 's1' }])
    await settingsRepo.find(c, { appId: 'a', tenantId: 't', subTenantId: null })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/sub_tenant_id IS NOT DISTINCT FROM \$3/)
    expect(params).toEqual(['a', 't', null])
  })
  it('upsert usa ON CONFLICT y default [] para amounts', async () => {
    const c = mockClient([{ id: 's1' }])
    await settingsRepo.upsert(c, { appId: 'a', tenantId: 't' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id, sub_tenant_id\) DO UPDATE/)
    expect(params).toEqual(['a', 't', null, []])
  })
})

describe('fiscal-certificates.repository', () => {
  it('findById → null si no existe', async () => {
    expect(await certsRepo.findById(mockClient([]), 'ghost')).toBeNull()
  })
  it('markSent setea sent_at = now()', async () => {
    const c = mockClient([{ id: 'cert1', sent_at: '2026-06-04' }])
    const r = await certsRepo.markSent(c, 'cert1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET sent_at = now\(\)/)
    expect(r.id).toBe('cert1')
  })
})
