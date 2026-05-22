// apps.repository — CRUD del registro plataforma `platform_tenants.apps`.
// El service ya está testeado en apps.service.test.js; este se enfoca en el
// SHAPE del SQL: qué columnas se proyectan, qué placeholders parametrizados se
// usan, qué WHERE filtra. Un grep regresion test, esencialmente — si alguien
// renombra una columna en migrations y olvida el repo, este test cae.

import { describe, it, expect, vi } from 'vitest'

import * as repo from '../repositories/apps.repository.js'

const APP_COLUMNS_RE = /id,\s*app_id,\s*display_name,\s*subdomain,\s*jwt_audience,\s*status,\s*splitpay_enabled,\s*enabled_modules,\s*created_at/

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

// ── findAll / findByAppId ────────────────────────────────────────────

describe('findAll', () => {
  it('SELECT con todas las columnas + ORDER BY created_at', async () => {
    const c = mockClient([{ app_id: 'aikikan' }])
    await repo.findAll(c)
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(APP_COLUMNS_RE)
    expect(sql).toMatch(/FROM platform_tenants\.apps/)
    expect(sql).toMatch(/ORDER BY created_at/)
  })

  it('SELECT sin params (no WHERE)', async () => {
    const c = mockClient([])
    await repo.findAll(c)
    expect(c.query.mock.calls[0][1]).toBeUndefined()
  })
})

describe('findByAppId', () => {
  it('WHERE app_id = $1 parametrizado', async () => {
    const c = mockClient([{ app_id: 'aikikan' }])
    await repo.findByAppId(c, 'aikikan')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1/)
    expect(params).toEqual(['aikikan'])
  })

  it('row vacío → null (no undefined)', async () => {
    const c = mockClient([])
    const r = await repo.findByAppId(c, 'ghost')
    expect(r).toBeNull()
  })
})

// ── create ──────────────────────────────────────────────────────────

describe('create', () => {
  it('INSERT con 5 params ordenados (app_id, display_name, subdomain, jwt_audience, splitpay_enabled)', async () => {
    const c = mockClient([{ id: 'app-uuid' }])
    await repo.create(c, {
      appId: 'aikikan', displayName: 'Aikikan', subdomain: 'aikikan',
      jwtAudience: 'apphub', splitpayEnabled: false,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_tenants\.apps/)
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5\)/)
    expect(sql).toMatch(/RETURNING/)
    expect(params).toEqual(['aikikan', 'Aikikan', 'aikikan', 'apphub', false])
  })

  it('splitpayEnabled default = false', async () => {
    const c = mockClient([{}])
    await repo.create(c, {
      appId: 'x', displayName: 'X', subdomain: 'x', jwtAudience: 'aud',
    })
    expect(c.query.mock.calls[0][1][4]).toBe(false)
  })
})

// ── updateStatus / updateSplitpayEnabled / updateEnabledModules ─────

describe('updateStatus', () => {
  it('UPDATE WHERE app_id = $1 SET status = $2', async () => {
    const c = mockClient([{ status: 'suspended' }])
    await repo.updateStatus(c, 'aikikan', 'suspended')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_tenants\.apps SET status = \$2 WHERE app_id = \$1/)
    expect(params).toEqual(['aikikan', 'suspended'])
  })

  it('app inexistente → rows=[] → null', async () => {
    const c = mockClient([])
    const r = await repo.updateStatus(c, 'ghost', 'active')
    expect(r).toBeNull()
  })
})

describe('updateSplitpayEnabled', () => {
  it('boolean propaga como $2', async () => {
    const c = mockClient([{ splitpay_enabled: true }])
    await repo.updateSplitpayEnabled(c, 'aikikan', true)
    expect(c.query.mock.calls[0][1]).toEqual(['aikikan', true])
  })
})

describe('updateEnabledModules', () => {
  it('array de strings propaga como $2 (Postgres TEXT[])', async () => {
    const c = mockClient([{ enabled_modules: ['leads', 'donations'] }])
    await repo.updateEnabledModules(c, 'aikikan', ['leads', 'donations'])
    expect(c.query.mock.calls[0][1]).toEqual(['aikikan', ['leads', 'donations']])
  })

  it('array vacío permitido (deshabilitar todos los módulos)', async () => {
    const c = mockClient([{ enabled_modules: [] }])
    await repo.updateEnabledModules(c, 'aikikan', [])
    expect(c.query.mock.calls[0][1]).toEqual(['aikikan', []])
  })
})
