// leads.repository — SQL shape de platform_leads.leads + lead_activities.
// Valida proyección de columnas, params parametrizados, filtros combinados,
// update parcial dinámico, conversión one-shot y el timeline de actividad.
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
  it('INSERT en platform_leads.leads con 21 params en orden', async () => {
    const c = mockClient([{ id: 'l1', created_at: 'now', status: 'new' }])
    const out = await repo.insert(c, {
      ...lead,
      appId: 'aikikan', customFields: { plan: 'pro' },
      utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'brand',
      utmTerm: 'crm', utmContent: 'ad1',
      referrer: 'https://google.com', landingUrl: 'https://hulkstein.com',
      consentText: 'Acepto la política', consentVersion: 'v1',
      consentAt: 'sealed',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_leads\.leads/)
    expect(sql).toMatch(/RETURNING id, created_at, status/)
    expect(params).toEqual([
      'Ana', 'ana@x.com', 'Tienda Ana', '600', 'shop', 'hola', 'landing',
      '1.2.3.4', 'curl', 'aikikan', { plan: 'pro' },
      'google', 'cpc', 'brand', 'crm', 'ad1',
      'https://google.com', 'https://hulkstein.com',
      'Acepto la política', 'v1', 'sealed',
    ])
    expect(out).toEqual({ id: 'l1', created_at: 'now', status: 'new' })
  })

  it('campos opcionales ausentes → null', async () => {
    const c = mockClient([{ id: 'l1' }])
    await repo.insert(c, { contactName: 'Bob', email: 'bob@x.com' })
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual([
      'Bob', 'bob@x.com', ...Array(19).fill(null),
    ])
  })
})

describe('list', () => {
  it('sin filtros → no WHERE; ORDER BY created_at DESC; LIMIT/OFFSET por defecto', async () => {
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

  it('filtros combinados: industry + tag + assignedTo uuid', async () => {
    const c = mockClient([])
    await repo.list(c, { industry: 'shop', tag: 'vip', assignedTo: 'u1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/industry = \$1/)
    expect(sql).toMatch(/\$2 = ANY\(tags\)/)
    expect(sql).toMatch(/assigned_to = \$3/)
    expect(params).toEqual(['shop', 'vip', 'u1', 100, 0])
  })

  it("assignedTo 'none' → IS NULL sin param", async () => {
    const c = mockClient([])
    await repo.list(c, { assignedTo: 'none' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/assigned_to IS NULL/)
    expect(params).toEqual([100, 0])
  })

  it('búsqueda q → ILIKE sobre nombre/email/empresa/mensaje con un solo param', async () => {
    const c = mockClient([])
    await repo.list(c, { q: 'ana' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/contact_name ILIKE \$1 OR email ILIKE \$1 OR business_name ILIKE \$1 OR message ILIKE \$1/)
    expect(params).toEqual(['%ana%', 100, 0])
  })

  it('followUpDue → next_follow_up_at <= now() sin param', async () => {
    const c = mockClient([])
    await repo.list(c, { followUpDue: true })
    expect(c.query.mock.calls[0][0]).toMatch(/next_follow_up_at <= now\(\)/)
  })

  it('sort + dir asc', async () => {
    const c = mockClient([])
    await repo.list(c, { sort: 'score', dir: 'asc' })
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY score ASC/)
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

describe('update (parcial dinámico)', () => {
  it('solo toca las columnas presentes + updated_at', async () => {
    const c = mockClient([{ id: 'l1', status: 'qualified' }])
    const out = await repo.update(c, 'l1', { status: 'qualified', assignedTo: 'u1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$2, assigned_to = \$3, updated_at = now\(\)/)
    expect(sql).toMatch(/WHERE id = \$1/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params).toEqual(['l1', 'qualified', 'u1'])
    expect(out).toEqual({ id: 'l1', status: 'qualified' })
  })

  it('null explícito sí viaja (desasignar)', async () => {
    const c = mockClient([{ id: 'l1' }])
    await repo.update(c, 'l1', { assignedTo: null })
    expect(c.query.mock.calls[0][1]).toEqual(['l1', null])
  })

  it('sin campos → fallback a findById (no UPDATE)', async () => {
    const c = mockClient([{ id: 'l1' }])
    await repo.update(c, 'l1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_leads\.leads/)
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.update(c, 'ghost', { status: 'lost' })).toBeNull()
  })
})

describe('convert', () => {
  it('one-shot: WHERE converted_tenant_id IS NULL; fija won + converted_*', async () => {
    const c = mockClient([{ id: 'l1', status: 'won' }])
    const out = await repo.convert(c, 'l1', 't1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/converted_tenant_id = \$2/)
    expect(sql).toMatch(/status = 'won'/)
    expect(sql).toMatch(/WHERE id = \$1 AND converted_tenant_id IS NULL/)
    expect(params).toEqual(['l1', 't1'])
    expect(out).toEqual({ id: 'l1', status: 'won' })
  })

  it('ya convertido → null (0 filas)', async () => {
    const c = mockClient([])
    expect(await repo.convert(c, 'l1', 't1')).toBeNull()
  })
})

describe('remove (GDPR)', () => {
  it('DELETE WHERE id=$1 RETURNING id, email', async () => {
    const c = mockClient([{ id: 'l1', email: 'x@x' }])
    const out = await repo.remove(c, 'l1')
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_leads\.leads WHERE id = \$1/)
    expect(out).toEqual({ id: 'l1', email: 'x@x' })
  })

  it('inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.remove(c, 'ghost')).toBeNull()
  })
})

describe('updateStatus (legacy)', () => {
  it('delega en update() con status + staffNotes', async () => {
    const c = mockClient([{ id: 'l1', status: 'contacted' }])
    const out = await repo.updateStatus(c, 'l1', 'contacted', 'nota')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$2, staff_notes = \$3/)
    expect(params).toEqual(['l1', 'contacted', 'nota'])
    expect(out).toEqual({ id: 'l1', status: 'contacted' })
  })

  it('staffNotes ausente → no toca staff_notes', async () => {
    const c = mockClient([{ id: 'l1' }])
    await repo.updateStatus(c, 'l1', 'closed')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/staff_notes/)
    expect(params).toEqual(['l1', 'closed'])
  })
})

describe('lead_activities', () => {
  it('insertActivity con autor + metadata', async () => {
    const c = mockClient([{ id: 'a1', created_at: 'now', type: 'status_change' }])
    const out = await repo.insertActivity(c, 'l1', {
      authorUserId: 'u1', authorEmail: 's@x', type: 'status_change',
      body: null, metadata: { from: 'new', to: 'contacted' },
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_leads\.lead_activities/)
    expect(params).toEqual(['l1', 'u1', 's@x', 'status_change', null, { from: 'new', to: 'contacted' }])
    expect(out).toEqual({ id: 'a1', created_at: 'now', type: 'status_change' })
  })

  it('listActivities ordena DESC con paginación', async () => {
    const c = mockClient([{ id: 'a1' }])
    const out = await repo.listActivities(c, 'l1', { limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE lead_id = \$1/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual(['l1', 10, 5])
    expect(out).toEqual([{ id: 'a1' }])
  })
})
