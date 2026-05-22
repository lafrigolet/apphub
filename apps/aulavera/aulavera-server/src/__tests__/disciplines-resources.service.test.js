// disciplines.service + resources.service de aulavera-server.
// Contrato:
//   - listDisciplines: scope = (APP_ID env, tenantId param, sub=null).
//       · activeOnly=true (default) → WHERE active = TRUE.
//       · activeOnly=false → sin filter de active.
//       · ORDER BY position ASC, name ASC (cambiar el order es BREAKING para el portal).
//   - listResources: filtra opcionalmente por type.
//       · type='video' → WHERE type = $1 parametrizado (anti-SQLi).
//       · ORDER BY type ASC, position ASC, title ASC.
//       · activeOnly=true por defecto.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
    EXPECTED_APP_ID: 'aulavera',
  },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))

import { listDisciplines } from '../services/disciplines.service.js'
import { listResources } from '../services/resources.service.js'
import { withTenantTransaction } from '../lib/db.js'

const TENANT = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  // El service llama repo.listX(client, {...}); el client real lleva un .query
  // que mockeamos en cada test.
})

function mockClient(rows = []) {
  const client = { query: vi.fn().mockResolvedValue({ rows }) }
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
  return client
}

// ── listDisciplines ─────────────────────────────────────────────────

describe('listDisciplines', () => {
  it('happy: usa scope (app="aulavera", tenant, sub=null)', async () => {
    const client = mockClient([{ id: 'd1', slug: 'aikido', position: 1, name: 'Aikido' }])
    await listDisciplines(TENANT)
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), 'aulavera', TENANT, null, expect.any(Function),
    )
  })

  it('activeOnly=true default → WHERE active = TRUE en SQL', async () => {
    const client = mockClient([])
    await listDisciplines(TENANT)
    const sql = client.query.mock.calls[0][0]
    expect(sql).toMatch(/WHERE active = TRUE/)
  })

  it('activeOnly=false → SIN WHERE active', async () => {
    const client = mockClient([])
    await listDisciplines(TENANT, { activeOnly: false })
    const sql = client.query.mock.calls[0][0]
    expect(sql).not.toMatch(/WHERE active = TRUE/)
  })

  it('ORDER BY = position ASC, name ASC (regression — el portal depende)', async () => {
    const client = mockClient([])
    await listDisciplines(TENANT)
    expect(client.query.mock.calls[0][0]).toMatch(/ORDER BY position ASC, name ASC/)
  })

  it('proyecta columns esperadas (id, slug, name, body, icon, state, position, active, …)', async () => {
    const client = mockClient([])
    await listDisciplines(TENANT)
    const sql = client.query.mock.calls[0][0]
    expect(sql).toMatch(/id,\s+slug,\s+name,\s+body,\s+icon,\s+state,\s+position,\s+active/)
  })

  it('retorna las rows del repo tal cual', async () => {
    mockClient([
      { id: 'd1', position: 1, name: 'A' },
      { id: 'd2', position: 2, name: 'B' },
    ])
    const r = await listDisciplines(TENANT)
    expect(r).toHaveLength(2)
    expect(r[0].position).toBe(1)
  })
})

// ── listResources ───────────────────────────────────────────────────

describe('listResources', () => {
  it('sin type → solo activeOnly filter', async () => {
    const client = mockClient([])
    await listResources(TENANT)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/WHERE active = TRUE/)
    expect(sql).not.toMatch(/type = \$/)
    expect(params).toEqual([])
  })

  it('type="video" → AGREGA WHERE type = $1 parametrizado (anti-SQLi)', async () => {
    const client = mockClient([])
    await listResources(TENANT, { type: 'video' })
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/type = \$1/)
    expect(params).toEqual(['video'])
  })

  it('type="; DROP TABLE x;" se pasa como param, no se concatena al SQL', async () => {
    const client = mockClient([])
    await listResources(TENANT, { type: "'; DROP TABLE x; --" })
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).not.toContain('DROP TABLE')                      // ¡critical regression!
    expect(params).toEqual(["'; DROP TABLE x; --"])
  })

  it('activeOnly=false + type="link" → solo filter de type (no active)', async () => {
    const client = mockClient([])
    await listResources(TENANT, { activeOnly: false, type: 'link' })
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).not.toMatch(/active = TRUE/)
    expect(sql).toMatch(/type = \$1/)
    expect(params).toEqual(['link'])
  })

  it('ORDER BY = type ASC, position ASC, title ASC', async () => {
    const client = mockClient([])
    await listResources(TENANT)
    expect(client.query.mock.calls[0][0]).toMatch(/ORDER BY type ASC, position ASC, title ASC/)
  })

  it('proyecta columns esperadas (incluye requires_membership)', async () => {
    const client = mockClient([])
    await listResources(TENANT)
    const sql = client.query.mock.calls[0][0]
    expect(sql).toMatch(/requires_membership/)
    expect(sql).toMatch(/object_id/)
  })

  it('scope = (app="aulavera", tenant, sub=null)', async () => {
    mockClient([])
    await listResources(TENANT, { type: 'link' })
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), 'aulavera', TENANT, null, expect.any(Function),
    )
  })
})
