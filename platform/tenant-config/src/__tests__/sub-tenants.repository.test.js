// sub-tenants.repository — SQL shape de platform_tenants.sub_tenants.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/sub-tenants.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('findByTenant / findById', () => {
  it('findByTenant escopa por tenant_id + ORDER BY created_at', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.findByTenant(c, 't1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE tenant_id = \$1/)
    expect(sql).toMatch(/ORDER BY created_at/)
    expect(params).toEqual(['t1'])
    expect(r).toEqual([{ id: 's1' }])
  })

  it('findById escopa por tenant_id + id; null si no hay', async () => {
    const c = mockClient([])
    const r = await repo.findById(c, 't1', 's9')
    expect(c.query.mock.calls[0][1]).toEqual(['t1', 's9'])
    expect(r).toBeNull()
  })
})

describe('create', () => {
  it('inserta los 4 campos', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.create(c, { tenantId: 't1', appId: 'aikikan', displayName: 'Dojo Norte', slug: 'norte' })
    expect(c.query.mock.calls[0][1]).toEqual(['t1', 'aikikan', 'Dojo Norte', 'norte'])
  })
})

describe('update', () => {
  it('sin campos → delega en findById (no UPDATE)', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.update(c, 't1', 's1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT/)
  })

  it('con campos → SET dinámico escopado por tenant_id + id', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.update(c, 't1', 's1', { displayName: 'Nuevo', status: 'suspended' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET display_name = \$1, status = \$2/)
    expect(sql).toMatch(/WHERE tenant_id = \$3 AND id = \$4/)
    expect(params).toEqual(['Nuevo', 'suspended', 't1', 's1'])
  })

  it('ignora campos no permitidos', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.update(c, 't1', 's1', { tenantId: 'hack', slug: 'ok' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET slug = \$1/)
    expect(params).toEqual(['ok', 't1', 's1'])
  })
})

describe('remove', () => {
  it('DELETE escopado, devuelve fila o null', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.remove(c, 't1', 's1')
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_tenants\.sub_tenants/)
    expect(c.query.mock.calls[0][1]).toEqual(['t1', 's1'])
    expect(r).toEqual({ id: 's1' })

    const c2 = mockClient([])
    expect(await repo.remove(c2, 't1', 'x')).toBeNull()
  })
})
