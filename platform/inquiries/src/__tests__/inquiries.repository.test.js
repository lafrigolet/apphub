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
  it('INSERT en platform_inquiries.inquiries con 17 params en orden', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.insert(c, inquiry)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_inquiries\.inquiries/)
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11,\s+\$12, \$13, \$14, \$15, \$16, \$17\)/)
    expect(params).toEqual([
      'AB12CD', 'aikikan', 't1', null, 'Ana', 'ana@x.com', null, 'Hola',
      'mensaje', 'landing', { k: 'v' },
      null,           // category
      null, null, null, // consent_text, consent_version, consent_at
      '1.2.3.4', 'curl',
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
    expect(params[11]).toBeNull() // category
    expect(params[15]).toBeNull() // ip
    expect(params[16]).toBeNull() // user_agent
  })
})

describe('list', () => {
  it('sin filtros → WHERE deleted_at IS NULL; ORDER BY created_at DESC; LIMIT/OFFSET parametrizados', async () => {
    const c = mockClient([])
    await repo.list(c, {})
    const [sql, params] = c.query.mock.calls[0]
    // Siempre excluye soft-deleted por defecto.
    expect(sql).toMatch(/WHERE deleted_at IS NULL/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([100, 0]) // defaults limit/offset (sin params de filtro)
  })

  it('con status → WHERE … status=$1 y limit/offset al final', async () => {
    const c = mockClient([])
    await repo.list(c, { status: 'new', limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$1/)
    expect(params).toEqual(['new', 10, 5])
  })

  it('includeDeleted=true → sin filtro deleted_at IS NULL', async () => {
    const c = mockClient([])
    await repo.list(c, { includeDeleted: true })
    const [sql] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/deleted_at IS NULL/)
  })

  it('filtros combinados (source, category, email, assignedTo, fechas, q) → todos parametrizados', async () => {
    const c = mockClient([])
    await repo.list(c, {
      source: 'landing', category: 'ventas', email: 'A@x.com',
      assignedTo: 'staff-9', createdFrom: '2026-01-01', createdTo: '2026-02-01',
      q: 'factura', limit: 20, offset: 0,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/source = \$/)
    expect(sql).toMatch(/category = \$/)
    expect(sql).toMatch(/lower\(email\) = lower\(\$/)
    expect(sql).toMatch(/assigned_to = \$/)
    expect(sql).toMatch(/created_at >= \$/)
    expect(sql).toMatch(/created_at <= \$/)
    expect(sql).toMatch(/search_tsv @@ plainto_tsquery/)
    expect(params).toContain('landing')
    expect(params).toContain('ventas')
    expect(params).toContain('A@x.com')
    expect(params).toContain('staff-9')
    expect(params).toContain('factura')
  })

  it("assignedTo='none' → assigned_to IS NULL sin param", async () => {
    const c = mockClient([])
    await repo.list(c, { assignedTo: 'none' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/assigned_to IS NULL/)
    expect(params).toEqual([100, 0])
  })
})

describe('findById', () => {
  it('WHERE id=$1; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, 'iq9')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['iq9'])
  })
})

describe('findByReference', () => {
  it('WHERE reference=$1 excluyendo soft-deleted/anonimizadas; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findByReference(c, 'INQ-X')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE reference = \$1/)
    expect(sql).toMatch(/deleted_at IS NULL AND anonymized_at IS NULL/)
    expect(params).toEqual(['INQ-X'])
  })

  it('row presente → lo devuelve', async () => {
    const c = mockClient([{ id: 'i-1', reference: 'INQ-X' }])
    expect(await repo.findByReference(c, 'INQ-X')).toMatchObject({ id: 'i-1' })
  })
})

describe('findRetentionDue', () => {
  it('selecciona ids más viejos que olderThan no anonimizados, con LIMIT', async () => {
    const c = mockClient([{ id: 'i-1' }, { id: 'i-2' }])
    const olderThan = new Date('2026-01-01T00:00:00Z')
    const ids = await repo.findRetentionDue(c, olderThan, 100)
    expect(ids).toEqual(['i-1', 'i-2'])
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/created_at < \$1/)
    expect(sql).toMatch(/anonymized_at IS NULL/)
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(params).toEqual([olderThan, 100])
  })

  it('default LIMIT 500 cuando no se pasa', async () => {
    const c = mockClient([])
    await repo.findRetentionDue(c, new Date())
    expect(c.query.mock.calls[0][1][1]).toBe(500)
  })
})

describe('updateStatus — FSM stamping', () => {
  it('contacted → stampa contacted_at = COALESCE(contacted_at, now())', async () => {
    const c = mockClient([{ id: 'iq1', status: 'contacted' }])
    await repo.updateStatus(c, 'iq1', 'contacted', 'nota')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/contacted_at = COALESCE\(contacted_at, now\(\)\)/)
    expect(params).toEqual(['iq1', 'contacted', 'nota', null])
  })

  it('resolved → stampa closed_at; close_reason se sella vía COALESCE', async () => {
    const c = mockClient([{ id: 'iq1', status: 'resolved' }])
    await repo.updateStatus(c, 'iq1', 'resolved', null, 'resuelto')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/closed_at = COALESCE\(closed_at, now\(\)\)/)
    expect(sql).toMatch(/close_reason = COALESCE\(\$4, close_reason\)/)
    expect(params).toEqual(['iq1', 'resolved', null, 'resuelto'])
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
    expect(c.query.mock.calls[0][0]).toMatch(/staff_notes\s+= COALESCE\(\$3, staff_notes\)/)
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

describe('assign', () => {
  it('UPDATE assigned_to=$2 WHERE id=$1', async () => {
    const c = mockClient([{ id: 'iq1', assigned_to: 'staff-9' }])
    await repo.assign(c, 'iq1', 'staff-9')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET assigned_to = \$2/)
    expect(params).toEqual(['iq1', 'staff-9'])
  })

  it('assignedTo null → desasigna', async () => {
    const c = mockClient([{ id: 'iq1' }])
    await repo.assign(c, 'iq1', null)
    expect(c.query.mock.calls[0][1]).toEqual(['iq1', null])
  })
})

describe('submitCsat', () => {
  it('solo sella si csat_submitted_at IS NULL', async () => {
    const c = mockClient([{ id: 'iq1', csat_score: 5 }])
    await repo.submitCsat(c, 'iq1', { score: 5, comment: 'genial' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/csat_submitted_at IS NULL/)
    expect(params).toEqual(['iq1', 5, 'genial'])
  })
})

describe('softDelete / anonymize', () => {
  it('softDelete → deleted_at COALESCE; RETURNING sin PII', async () => {
    const c = mockClient([{ id: 'iq1', app_id: 'a', tenant_id: 't' }])
    await repo.softDelete(c, 'iq1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/deleted_at = COALESCE\(deleted_at, now\(\)\)/)
    expect(sql).toMatch(/RETURNING id, app_id, tenant_id/)
    expect(params).toEqual(['iq1'])
  })

  it('anonymize → borra PII y sella anonymized_at; idempotente', async () => {
    const c = mockClient([{ id: 'iq1', email: 'anonymized@removed.invalid' }])
    await repo.anonymize(c, 'iq1')
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/contact_name\s+= '\[anonymized\]'/)
    expect(sql).toMatch(/email\s+= 'anonymized@removed\.invalid'/)
    expect(sql).toMatch(/anonymized_at IS NULL/)
  })
})

describe('analytics', () => {
  it('agrega conteos por estado + MTR/MTTR + CSAT; ventana opcional', async () => {
    const c = mockClient([{ total: 3 }])
    await repo.analytics(c, { createdFrom: '2026-01-01', createdTo: '2026-02-01' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE status = 'spam'\)/)
    expect(sql).toMatch(/avg\(EXTRACT\(EPOCH FROM \(contacted_at - created_at\)\)\)/)
    expect(sql).toMatch(/avg\(csat_score\)/)
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(params).toEqual(['2026-01-01', '2026-02-01'])
  })

  it('sin ventana → solo el filtro deleted_at', async () => {
    const c = mockClient([{ total: 0 }])
    await repo.analytics(c, {})
    expect(c.query.mock.calls[0][1]).toEqual([])
  })
})

describe('insertActivity / listActivities', () => {
  it('insertActivity con app_id+tenant_id (RLS) + autor + metadata', async () => {
    const c = mockClient([{ id: 'a-1' }])
    await repo.insertActivity(c, 'iq1', {
      appId: 'aikikan', tenantId: 't1', authorUserId: 'u-1', authorEmail: 'u@x.com',
      type: 'note', body: 'hola', metadata: { k: 'v' },
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_inquiries\.inquiry_activities/)
    expect(params).toEqual(['iq1', 'aikikan', 't1', 'u-1', 'u@x.com', 'note', 'hola', { k: 'v' }])
  })

  it('listActivities ORDER BY created_at DESC con paginación', async () => {
    const c = mockClient([])
    await repo.listActivities(c, 'iq1', { limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual(['iq1', 10, 5])
  })
})
