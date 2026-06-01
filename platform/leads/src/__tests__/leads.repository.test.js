// leads.repository — SQL shape de platform_leads.leads.
// Valida proyección de columnas, params parametrizados, filtro opcional por
// status, paginación y el COALESCE de staff_notes en updateStatus.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/leads.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const lead = {
  contactName: 'Ana', email: 'ana@x.com', businessName: 'Tienda Ana',
  phone: '600', industry: 'shop', message: 'hola', source: 'landing',
  ip: '1.2.3.4', userAgent: 'curl',
}

describe('insert', () => {
  it('INSERT en platform_leads.leads con 9 params en orden', async () => {
    const c = mockClient([{ id: 'l1', created_at: 'now', status: 'new' }])
    const out = await repo.insert(c, lead)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_leads\.leads/)
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9\)/)
    expect(sql).toMatch(/RETURNING id, created_at, status/)
    expect(params).toEqual([
      'Ana', 'ana@x.com', 'Tienda Ana', '600', 'shop', 'hola', 'landing',
      '1.2.3.4', 'curl',
    ])
    expect(out).toEqual({ id: 'l1', created_at: 'now', status: 'new' })
  })

  it('campos opcionales ausentes → null', async () => {
    const c = mockClient([{ id: 'l1' }])
    await repo.insert(c, { contactName: 'Bob', email: 'bob@x.com' })
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual(['Bob', 'bob@x.com', null, null, null, null, null, null, null])
  })
})

describe('list', () => {
  it('sin status → no WHERE; ORDER BY created_at DESC; LIMIT/OFFSET por defecto', async () => {
    const c = mockClient([{ id: 'l1' }])
    const out = await repo.list(c, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([100, 0])
    expect(out).toEqual([{ id: 'l1' }])
  })

  it('sin args → usa defaults', async () => {
    const c = mockClient([])
    await repo.list(c)
    expect(c.query.mock.calls[0][1]).toEqual([100, 0])
  })

  it('con status → WHERE status=$1 y limit/offset al final', async () => {
    const c = mockClient([])
    await repo.list(c, { status: 'qualified', limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE status = \$1/)
    expect(sql).toMatch(/LIMIT \$2 OFFSET \$3/)
    expect(params).toEqual(['qualified', 10, 5])
  })
})

describe('findById', () => {
  it('WHERE id=$1; devuelve row', async () => {
    const c = mockClient([{ id: 'l9', email: 'x@x' }])
    const out = await repo.findById(c, 'l9')
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE id = \$1/)
    expect(c.query.mock.calls[0][1]).toEqual(['l9'])
    expect(out).toEqual({ id: 'l9', email: 'x@x' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, 'ghost')).toBeNull()
  })
})

describe('updateStatus', () => {
  it('UPDATE status=$2; staff_notes vía COALESCE($3, staff_notes); WHERE id=$1', async () => {
    const c = mockClient([{ id: 'l1', status: 'qualified', staff_notes: 'nota' }])
    const out = await repo.updateStatus(c, 'l1', 'qualified', 'nota')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_leads\.leads/)
    expect(sql).toMatch(/SET status = \$2/)
    expect(sql).toMatch(/staff_notes = COALESCE\(\$3, staff_notes\)/)
    expect(sql).toMatch(/WHERE id = \$1/)
    expect(params).toEqual(['l1', 'qualified', 'nota'])
    expect(out).toEqual({ id: 'l1', status: 'qualified', staff_notes: 'nota' })
  })

  it('staffNotes ausente → null (no borra notas con COALESCE)', async () => {
    const c = mockClient([{ id: 'l1' }])
    await repo.updateStatus(c, 'l1', 'closed')
    expect(c.query.mock.calls[0][1]).toEqual(['l1', 'closed', null])
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.updateStatus(c, 'ghost', 'closed', null)).toBeNull()
  })
})
