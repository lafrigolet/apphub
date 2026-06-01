// inquiries.repository — SQL shape de platform_inquiries.inquiries.
// Valida proyección de columnas, params parametrizados (anti-injection),
// filtro opcional por status, paginación y el stamping FSM de updateStatus.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/inquiries.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const inquiry = {
  reference: 'AB12CD', appId: 'aikikan', tenantId: 't1', subTenantId: null,
  contactName: 'Ana', email: 'ana@x.com', phone: null, subject: 'Hola',
  message: 'mensaje', source: 'landing', metadata: { k: 'v' },
  ip: '1.2.3.4', userAgent: 'curl',
}

describe('insert', () => {
  it('INSERT en platform_inquiries.inquiries con 13 params en orden', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.insert(c, inquiry)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_inquiries\.inquiries/)
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13\)/)
    expect(params).toEqual([
      'AB12CD', 'aikikan', 't1', null, 'Ana', 'ana@x.com', null, 'Hola',
      'mensaje', 'landing', { k: 'v' }, '1.2.3.4', 'curl',
    ])
  })

  it('metadata ausente → objeto vacío (no null)', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.insert(c, { ...inquiry, metadata: undefined })
    expect(c.query.mock.calls[0][1][10]).toEqual({})
  })

  it('campos opcionales ausentes → null (rama nullish de cada ?? null)', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.insert(c, {
      reference: 'R', appId: 'a', tenantId: 't', contactName: 'Ana',
      email: 'ana@x.com', message: 'm',
      // subTenantId, phone, subject, source, ip, userAgent, metadata todos undefined
    })
    const params = c.query.mock.calls[0][1]
    expect(params[3]).toBeNull()  // sub_tenant_id
    expect(params[6]).toBeNull()  // phone
    expect(params[7]).toBeNull()  // subject
    expect(params[9]).toBeNull()  // source
    expect(params[11]).toBeNull() // ip
    expect(params[12]).toBeNull() // user_agent
  })
})

describe('list', () => {
  it('sin status → no WHERE; ORDER BY created_at DESC; LIMIT/OFFSET parametrizados', async () => {
    const c = mockClient([])
    await repo.list(c, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([100, 0]) // defaults limit/offset
  })

  it('con status → WHERE status=$1 y limit/offset al final', async () => {
    const c = mockClient([])
    await repo.list(c, { status: 'new', limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE status = \$1/)
    expect(params).toEqual(['new', 10, 5])
  })
})

describe('findById', () => {
  it('WHERE id=$1; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, 'iq9')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['iq9'])
  })
})

describe('updateStatus — FSM stamping', () => {
  it('contacted → stampa contacted_at = COALESCE(contacted_at, now())', async () => {
    const c = mockClient([{ id: 'iq1', status: 'contacted' }])
    await repo.updateStatus(c, 'iq1', 'contacted', 'nota')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/contacted_at = COALESCE\(contacted_at, now\(\)\)/)
    expect(params).toEqual(['iq1', 'contacted', 'nota'])
  })

  it('closed → stampa closed_at; spam → idem', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.updateStatus(c, 'iq1', 'closed', null)
    expect(c.query.mock.calls[0][0]).toMatch(/closed_at = COALESCE\(closed_at, now\(\)\)/)

    const c2 = mockClient([{ id: 'iq1' }])
    await repo.updateStatus(c2, 'iq1', 'spam', null)
    expect(c2.query.mock.calls[0][0]).toMatch(/closed_at = COALESCE\(closed_at, now\(\)\)/)
  })

  it('staff_notes usa COALESCE para no borrar notas previas con null', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.updateStatus(c, 'iq1', 'contacted', null)
    expect(c.query.mock.calls[0][0]).toMatch(/staff_notes = COALESCE\(\$3, staff_notes\)/)
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.updateStatus(c, 'ghost', 'closed', null)).toBeNull()
  })

  it('status sin stamp (p.ej. "new") → SET sin clausula de timestamp (rama else)', async () => {
    const c = mockClient([{ id: 'iq1', status: 'new' }])
    await repo.updateStatus(c, 'iq1', 'new', null)
    const sql = c.query.mock.calls[0][0]
    // No hay clausula de stamp (los nombres de columna sí salen en RETURNING).
    expect(sql).not.toMatch(/contacted_at = COALESCE/)
    expect(sql).not.toMatch(/closed_at = COALESCE/)
    expect(sql).toMatch(/SET\s+status\s+= \$2/)
  })
})
