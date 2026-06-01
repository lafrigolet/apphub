// tenants.repository — SQL shape de platform_tenants.tenants.
// Valida proyección de FULL_COLUMNS, filtro opcional por app_id, los CASE
// de updateStatus, el write-once de markBootstrapCompleted y el builder
// dinámico de update() (allowlist de columnas, no-op cuando vacío).
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/tenants.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('findAll', () => {
  it('con appId → WHERE app_id=$1', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.findAll(c, 'aikikan')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1/)
    expect(params).toEqual(['aikikan'])
  })

  it('sin appId → sin WHERE, params vacíos', async () => {
    const c = mockClient([])
    await repo.findAll(c)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(params).toEqual([])
  })
})

describe('findById / findBySubdomain / findAllActive', () => {
  it('findById → null sin row', async () => {
    expect(await repo.findById(mockClient([]), 'x')).toBeNull()
  })
  it('findById → row', async () => {
    expect(await repo.findById(mockClient([{ id: 't1' }]), 't1')).toEqual({ id: 't1' })
  })
  it('findBySubdomain filtra por subdomain', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.findBySubdomain(c, 'aikikan')
    expect(c.query.mock.calls[0][1]).toEqual(['aikikan'])
  })
  it('findBySubdomain → null sin row', async () => {
    expect(await repo.findBySubdomain(mockClient([]), 'x')).toBeNull()
  })
  it('findAllActive excluye archived', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.findAllActive(c)
    expect(c.query.mock.calls[0][0]).toMatch(/status <> 'archived'/)
  })
})

describe('create', () => {
  it('INSERT con app_id/display_name/subdomain', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.create(c, { appId: 'a', displayName: 'Dojo', subdomain: 'dojo' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_tenants\.tenants/)
    expect(params).toEqual(['a', 'Dojo', 'dojo'])
  })
})

describe('updateStatus', () => {
  it('CASE para suspend_reason y archived_at; params en orden', async () => {
    const c = mockClient([{ id: 't1', status: 'suspended' }])
    await repo.updateStatus(c, 't1', { status: 'suspended', suspendReason: 'abuse', archivedAt: null })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/suspend_reason = CASE WHEN \$2 = 'suspended'/)
    expect(sql).toMatch(/archived_at\s+= CASE WHEN \$2 = 'archived'/)
    expect(params).toEqual(['t1', 'suspended', 'abuse', null])
  })

  it('defaults null cuando faltan reason/archivedAt', async () => {
    const c = mockClient([{}])
    await repo.updateStatus(c, 't1', { status: 'active' })
    expect(c.query.mock.calls[0][1]).toEqual(['t1', 'active', null, null])
  })

  it('sin row → null', async () => {
    expect(await repo.updateStatus(mockClient([]), 'x', { status: 'active' })).toBeNull()
  })
})

describe('markBootstrapCompleted', () => {
  it('COALESCE write-once', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.markBootstrapCompleted(c, 't1')
    expect(c.query.mock.calls[0][0]).toMatch(/bootstrap_completed_at = COALESCE\(bootstrap_completed_at, now\(\)\)/)
  })
  it('sin row → null', async () => {
    expect(await repo.markBootstrapCompleted(mockClient([]), 'x')).toBeNull()
  })
})

describe('update — builder dinámico', () => {
  it('solo setea campos del allowlist presentes', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.update(c, 't1', { displayName: 'New', plan: 'pro', notAllowed: 'x' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/display_name = \$1/)
    expect(sql).toMatch(/plan = \$2/)
    expect(sql).not.toMatch(/notAllowed/)
    expect(params).toEqual(['New', 'pro', 't1'])
  })

  it('subscripción: mapea camelCase a snake_case', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.update(c, 't1', { subscriptionStatus: 'active', subscriptionAmountCents: 1000 })
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/subscription_status/)
    expect(sql).toMatch(/subscription_amount_cents/)
  })

  it('sin campos válidos → delega en findById (no UPDATE)', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.update(c, 't1', { notAllowed: 'x' })
    // findById hace un SELECT, no UPDATE
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT/)
    expect(c.query.mock.calls[0][0]).not.toMatch(/UPDATE/)
  })

  it('sin row → null', async () => {
    expect(await repo.update(mockClient([]), 'x', { displayName: 'X' })).toBeNull()
  })
})
