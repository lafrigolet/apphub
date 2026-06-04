// settings.repository — SQL shape de platform_inquiries.settings.
// Regresión: si una migración renombra columnas y el repo no se actualiza,
// estos tests caen. Validan tabla, WHERE parametrizado, ON CONFLICT y orden
// de params.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/settings.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('findByAppTenant', () => {
  it('SELECT FROM platform_inquiries.settings WHERE app_id=$1 AND tenant_id=$2', async () => {
    const c = mockClient([{ app_id: 'aikikan' }])
    await repo.findByAppTenant(c, 'aikikan', 't1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_inquiries\.settings/)
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(sql).toMatch(/contact_inbox_email/)
    expect(params).toEqual(['aikikan', 't1'])
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findByAppTenant(c, 'aikikan', 't1')).toBeNull()
  })
})

describe('upsert', () => {
  it('INSERT … ON CONFLICT (app_id, tenant_id) DO UPDATE … RETURNING *', async () => {
    const c = mockClient([{ contact_inbox_email: 'box@x.com' }])
    await repo.upsert(c, {
      appId: 'aikikan', tenantId: 't1',
      contactInboxEmail: 'box@x.com', replyToEmail: 'r@x.com',
      userThanksSubject: 'Gracias', userThanksBody: 'Cuerpo', retentionDays: 365,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_inquiries\.settings/)
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id\) DO UPDATE/)
    expect(sql).toMatch(/updated_at\s*=\s*now\(\)/)
    expect(sql).toMatch(/retention_days\s*=\s*EXCLUDED\.retention_days/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params).toEqual(['aikikan', 't1', 'box@x.com', 'r@x.com', 'Gracias', 'Cuerpo', 365])
  })

  it('campos opcionales ausentes → null en los params', async () => {
    const c = mockClient([{}])
    await repo.upsert(c, { appId: 'aikikan', tenantId: 't1', contactInboxEmail: 'box@x.com' })
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual(['aikikan', 't1', 'box@x.com', null, null, null, null])
  })

  it('devuelve la fila resultante (rows[0])', async () => {
    const row = { contact_inbox_email: 'box@x.com' }
    const c = mockClient([row])
    expect(await repo.upsert(c, { appId: 'a', tenantId: 't', contactInboxEmail: 'box@x.com' })).toBe(row)
  })
})
