// items.repository — SQL shape de platform_catalog.items + item_versions +
// item_images. Valida proyección de columnas, params parametrizados, scope
// activeOnly, construcción dinámica del UPDATE, y stamping de status/versión.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/items.repository.js'

function mockClient(rows = [], rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) }
}

describe('findAll', () => {
  it('activeOnly default → WHERE active = true; ORDER BY created_at', async () => {
    const c = mockClient([{ id: 'i1' }])
    const out = await repo.findAll(c)
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_catalog\.items/)
    expect(sql).toMatch(/WHERE active = true/)
    expect(sql).toMatch(/ORDER BY created_at/)
    expect(out).toEqual([{ id: 'i1' }])
  })

  it('activeOnly:false → sin filtro active', async () => {
    const c = mockClient([])
    await repo.findAll(c, { activeOnly: false })
    expect(c.query.mock.calls[0][0]).not.toMatch(/WHERE active/)
  })
})

describe('searchItems', () => {
  it('ILIKE parametrizado con comodines + scope active', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.searchItems(c, { q: 'barro', activeOnly: true })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/name ILIKE \$1 OR description ILIKE \$1/)
    expect(sql).toMatch(/AND active = true/)
    expect(params).toEqual(['%barro%'])
  })

  it('q ausente → comodín vacío; activeOnly:false sin filtro', async () => {
    const c = mockClient([])
    await repo.searchItems(c, { activeOnly: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(params).toEqual(['%%'])
    expect(sql).not.toMatch(/AND active = true/)
  })

  it('sin args → defaults (activeOnly true, q vacío)', async () => {
    const c = mockClient([])
    await repo.searchItems(c)
    expect(c.query.mock.calls[0][1]).toEqual(['%%'])
  })
})

describe('findById', () => {
  it('WHERE id=$1; row → row', async () => {
    const c = mockClient([{ id: 'i9' }])
    expect(await repo.findById(c, 'i9')).toEqual({ id: 'i9' })
    expect(c.query.mock.calls[0][1]).toEqual(['i9'])
  })
  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, 'ghost')).toBeNull()
  })
})

describe('create', () => {
  it('INSERT 9 params; defaults price/currency/metadata', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.create(c, {
      appId: 'shop', tenantId: 't1', subTenantId: null,
      name: 'Jarra', description: 'desc', priceCents: 1500, currency: 'usd',
      category: 'pots', metadata: { color: 'red' },
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_catalog\.items/)
    expect(params).toEqual([
      'shop', 't1', null, 'Jarra', 'desc', 1500, 'usd', 'pots', JSON.stringify({ color: 'red' }),
      null, null, null, null,
    ])
  })

  it('campos opcionales ausentes → defaults (0, eur, null)', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.create(c, { appId: 'shop', tenantId: 't1', name: 'X' })
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual(['shop', 't1', null, 'X', null, 0, 'eur', null, null, null, null, null, null])
  })
})

describe('update', () => {
  it('construye SET dinámico solo con campos definidos + updated_at; id al final', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.update(c, 'i1', { name: 'New', priceCents: 999, active: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET name = \$1, price_cents = \$2, active = \$3, updated_at = now\(\)/)
    expect(sql).toMatch(/WHERE id = \$4/)
    expect(params).toEqual(['New', 999, false, 'i1'])
  })

  it('todos los campos: description, currency, category, metadata serializado', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.update(c, 'i1', {
      name: 'N', description: 'd', priceCents: 1, currency: 'gbp',
      category: 'c', metadata: { a: 1 }, active: true,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/metadata = \$6/)
    expect(params).toEqual(['N', 'd', 1, 'gbp', 'c', JSON.stringify({ a: 1 }), true, 'i1'])
  })

  it('sin campos → delega a findById (no UPDATE)', async () => {
    const c = mockClient([{ id: 'i1' }])
    const out = await repo.update(c, 'i1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT .* FROM platform_catalog\.items\s+WHERE id = \$1/s)
    expect(out).toEqual({ id: 'i1' })
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.update(c, 'ghost', { name: 'X' })).toBeNull()
  })
})

describe('remove', () => {
  it('DELETE WHERE id=$1; rowCount>0 → true', async () => {
    const c = mockClient([], 1)
    expect(await repo.remove(c, 'i1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_catalog\.items WHERE id = \$1/)
    expect(c.query.mock.calls[0][1]).toEqual(['i1'])
  })
  it('rowCount 0 → false', async () => {
    const c = mockClient([], 0)
    expect(await repo.remove(c, 'ghost')).toBe(false)
  })
})

describe('setStatus', () => {
  it('UPDATE status=$2; published_at via CASE; stamp updated_at', async () => {
    const c = mockClient([{ id: 'i1', status: 'published' }])
    const out = await repo.setStatus(c, 'i1', 'published')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$2/)
    expect(sql).toMatch(/published_at = CASE WHEN \$2 = 'published' THEN now\(\) ELSE published_at END/)
    expect(params).toEqual(['i1', 'published'])
    expect(out).toEqual({ id: 'i1', status: 'published' })
  })
  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.setStatus(c, 'ghost', 'archived')).toBeNull()
  })
})

describe('publishVersion', () => {
  it('INSERT en item_versions con ON CONFLICT DO NOTHING + UPDATE version_number', async () => {
    const c = mockClient([])
    const snap = { app_id: 'shop', tenant_id: 't1', id: 'i1', name: 'X' }
    await repo.publishVersion(c, 'i1', 3, snap, 'u9')
    const [sql1, params1] = c.query.mock.calls[0]
    expect(sql1).toMatch(/INSERT INTO platform_catalog\.item_versions/)
    expect(sql1).toMatch(/ON CONFLICT \(item_id, version_number\) DO NOTHING/)
    expect(params1).toEqual(['shop', 't1', 'i1', 3, JSON.stringify(snap), 'u9'])
    const [sql2, params2] = c.query.mock.calls[1]
    expect(sql2).toMatch(/UPDATE platform_catalog\.items SET version_number = \$2 WHERE id = \$1/)
    expect(params2).toEqual(['i1', 3])
  })

  it('actorUserId ausente → null', async () => {
    const c = mockClient([])
    await repo.publishVersion(c, 'i1', 1, { app_id: 'a', tenant_id: 't' })
    expect(c.query.mock.calls[0][1][5]).toBeNull()
  })
})

describe('listVersions', () => {
  it('WHERE item_id=$1; ORDER BY version_number DESC', async () => {
    const c = mockClient([{ version_number: 2 }])
    const out = await repo.listVersions(c, 'i1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_catalog\.item_versions/)
    expect(sql).toMatch(/ORDER BY version_number DESC/)
    expect(params).toEqual(['i1'])
    expect(out).toEqual([{ version_number: 2 }])
  })
})

describe('listImages', () => {
  it('WHERE item_id=$1; ORDER BY display_order, created_at', async () => {
    const c = mockClient([{ id: 'img1' }])
    const out = await repo.listImages(c, 'i1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_catalog\.item_images/)
    expect(sql).toMatch(/ORDER BY display_order, created_at/)
    expect(params).toEqual(['i1'])
    expect(out).toEqual([{ id: 'img1' }])
  })
})

describe('insertImage', () => {
  it('INSERT ... SELECT desde items (hereda app_id/tenant_id); COALESCE displayOrder', async () => {
    const c = mockClient([{ id: 'img1' }])
    await repo.insertImage(c, { itemId: 'i1', objectId: 'obj', altText: 'alt', displayOrder: 2 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_catalog\.item_images/)
    expect(sql).toMatch(/SELECT i\.app_id, i\.tenant_id, i\.id/)
    expect(sql).toMatch(/COALESCE\(\$4, 0\)/)
    expect(params).toEqual(['i1', 'obj', 'alt', 2])
  })

  it('altText/displayOrder ausentes → null/0', async () => {
    const c = mockClient([{ id: 'img1' }])
    await repo.insertImage(c, { itemId: 'i1', objectId: 'obj' })
    expect(c.query.mock.calls[0][1]).toEqual(['i1', 'obj', null, 0])
  })

  it('sin item → null', async () => {
    const c = mockClient([])
    expect(await repo.insertImage(c, { itemId: 'ghost', objectId: 'o' })).toBeNull()
  })
})

describe('deleteImage', () => {
  it('DELETE WHERE id=$1; rowCount>0 → true', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteImage(c, 'img1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_catalog\.item_images WHERE id = \$1/)
    expect(c.query.mock.calls[0][1]).toEqual(['img1'])
  })
  it('rowCount 0 → false', async () => {
    const c = mockClient([], 0)
    expect(await repo.deleteImage(c, 'ghost')).toBe(false)
  })
})
