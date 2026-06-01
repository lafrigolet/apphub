// catalog search (1.12.7 · P2) — búsqueda por texto sobre nombre/descripción.
// Cubre el SHAPE del SQL (ILIKE parametrizado + scope activeOnly) y el wiring
// del service (q vacío → listItems; q con texto → searchItems del repo).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/items.repository.js')

import { searchItems as searchService, listItems } from '../services/items.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/items.repository.js'

const scope = { appId: 'aikikan', tenantId: 't1', subTenantId: null }
const client = { query: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  // withTenantTransaction(pool, app, tenant, sub, fn) → fn(client)
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
})

describe('service.searchItems — wiring', () => {
  it('q con texto → repo.searchItems con q trim + activeOnly', async () => {
    repo.searchItems.mockResolvedValue([{ id: 'i1' }])
    const out = await searchService({ ...scope, q: '  barro  ', activeOnly: true })
    expect(out).toEqual([{ id: 'i1' }])
    expect(repo.searchItems).toHaveBeenCalledWith(client, { q: 'barro', activeOnly: true })
    expect(repo.findAll).not.toHaveBeenCalled()
  })

  it('q vacío/espacios → cae en listItems (findAll), no busca', async () => {
    repo.findAll.mockResolvedValue([{ id: 'all' }])
    const out = await searchService({ ...scope, q: '   ', activeOnly: true })
    expect(out).toEqual([{ id: 'all' }])
    expect(repo.findAll).toHaveBeenCalledWith(client, { activeOnly: true })
    expect(repo.searchItems).not.toHaveBeenCalled()
  })

  it('q undefined → listItems', async () => {
    repo.findAll.mockResolvedValue([])
    await searchService({ ...scope, activeOnly: false })
    expect(repo.findAll).toHaveBeenCalledWith(client, { activeOnly: false })
  })
})

// SQL-shape del repo real (sin mock): importamos el módulo real bypassing el
// automock con vi.importActual.
describe('repo.searchItems — SQL shape', () => {
  it('ILIKE en name/description, término parametrizado con comodines, scope activeOnly', async () => {
    const { searchItems } = await vi.importActual('../repositories/items.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'i1' }] }) }
    await searchItems(c, { q: 'barro', activeOnly: true })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_catalog\.items/)
    expect(sql).toMatch(/name ILIKE \$1 OR description ILIKE \$1/)
    expect(sql).toMatch(/AND active = true/)
    expect(params).toEqual(['%barro%'])
  })

  it('activeOnly:false → sin filtro active', async () => {
    const { searchItems } = await vi.importActual('../repositories/items.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await searchItems(c, { q: 'x', activeOnly: false })
    expect(c.query.mock.calls[0][0]).not.toMatch(/active = true/)
  })

  it('término se parametriza (no se interpola) — anti-injection', async () => {
    const { searchItems } = await vi.importActual('../repositories/items.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await searchItems(c, { q: "'; DROP TABLE items;--" })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(params[0]).toBe("%'; DROP TABLE items;--%")
  })
})
