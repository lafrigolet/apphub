// audit.repository — SQL shape de platform_tenants.audit_log.
// Valida insert con defaults null, el builder de filtros de list (app/tenant)
// y el clamp del límite (1..1000).
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/audit.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('insert', () => {
  it('INSERT con 7 params; defaults null en opcionales', async () => {
    const c = mockClient([{ id: 'a1' }])
    await repo.insert(c, { appId: 'aikikan', action: 'tenant.create' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_tenants\.audit_log/)
    expect(params).toEqual([null, null, 'aikikan', null, 'tenant.create', null, null])
  })

  it('pasa todos los campos cuando están', async () => {
    const c = mockClient([{ id: 'a1' }])
    await repo.insert(c, {
      actorUserId: 'u1', actorRole: 'staff', appId: 'a', tenantId: 't1',
      action: 'tenant.suspend', detail: { reason: 'x' }, ip: '1.2.3.4',
    })
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'staff', 'a', 't1', 'tenant.suspend', { reason: 'x' }, '1.2.3.4'])
  })
})

describe('list', () => {
  it('sin filtros → solo LIMIT', async () => {
    const c = mockClient([])
    await repo.list(c, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(sql).toMatch(/ORDER BY ts DESC/)
    expect(params).toEqual([100]) // default limit
  })

  it('con appId + tenantId → WHERE doble', async () => {
    const c = mockClient([])
    await repo.list(c, { appId: 'a', tenantId: 't1', limit: 50 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(params).toEqual(['a', 't1', 50])
  })

  it('límite clampa a 1000 máximo', async () => {
    const c = mockClient([])
    await repo.list(c, { limit: 99999 })
    expect(c.query.mock.calls[0][1]).toEqual([1000])
  })

  it('límite inválido → default 100; mínimo 1', async () => {
    const c = mockClient([])
    await repo.list(c, { limit: 'abc' })
    expect(c.query.mock.calls[0][1]).toEqual([100])
    const c2 = mockClient([])
    await repo.list(c2, { limit: -5 })
    expect(c2.query.mock.calls[0][1]).toEqual([1])
  })
})
