// SQL shape for the priority-feature repo functions: soft-delete/restore,
// pagination counts, new create/update columns, categories + M:N.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/items.repository.js'

function mockClient(rows = [], rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) }
}

describe('findAll pagination + soft-delete scope', () => {
  it('excluye soft-deleted por defecto + ORDER BY created_at', async () => {
    const c = mockClient([])
    await repo.findAll(c)
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(sql).toMatch(/active = true/)
  })

  it('includeDeleted:true → sin filtro deleted_at', async () => {
    const c = mockClient([])
    await repo.findAll(c, { activeOnly: false, includeDeleted: true })
    expect(c.query.mock.calls[0][0]).not.toMatch(/deleted_at IS NULL/)
  })

  it('limit/offset → LIMIT $n OFFSET $m parametrizados', async () => {
    const c = mockClient([])
    await repo.findAll(c, { limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/LIMIT \$1 OFFSET \$2/)
    expect(params).toEqual([10, 5])
  })
})

describe('countAll / countSearch', () => {
  it('countAll devuelve total int', async () => {
    const c = mockClient([{ total: 7 }])
    expect(await repo.countAll(c)).toBe(7)
    expect(c.query.mock.calls[0][0]).toMatch(/COUNT\(\*\)::int AS total/)
  })

  it('countSearch parametriza el término', async () => {
    const c = mockClient([{ total: 2 }])
    await repo.countSearch(c, { q: 'barro' })
    expect(c.query.mock.calls[0][1]).toEqual(['%barro%'])
  })
})

describe('create includes slug/meta/item_type', () => {
  it('pasa slug, metaTitle, metaDescription, itemType', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.create(c, {
      appId: 'shop', tenantId: 't1', name: 'X',
      slug: 'x-slug', metaTitle: 'T', metaDescription: 'D', itemType: 'digital',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/slug, meta_title, meta_description, item_type/)
    expect(params.slice(-4)).toEqual(['x-slug', 'T', 'D', 'digital'])
  })
})

describe('update includes new columns + soft-delete guard', () => {
  it('actualiza slug/item_type y aplica WHERE deleted_at IS NULL', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.update(c, 'i1', { slug: 's', itemType: 'service' })
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/slug = \$1/)
    expect(sql).toMatch(/item_type = \$2/)
    expect(sql).toMatch(/AND deleted_at IS NULL/)
  })
})

describe('softDelete / restore', () => {
  it('softDelete stampa deleted_at + active=false', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.softDelete(c, 'i1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET deleted_at = now\(\), active = false/)
    expect(sql).toMatch(/AND deleted_at IS NULL/)
    expect(params).toEqual(['i1'])
  })

  it('restore limpia deleted_at solo si estaba borrado', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.restore(c, 'i1')
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET deleted_at = NULL/)
    expect(sql).toMatch(/AND deleted_at IS NOT NULL/)
  })

  it('softDelete inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.softDelete(c, 'ghost')).toBeNull()
  })
})

describe('categories repo', () => {
  it('createCategory inserta scope + parent', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.createCategory(c, { appId: 'shop', tenantId: 't1', parentId: 'p1', name: 'Sub', slug: 'sub' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_catalog\.categories/)
    expect(params).toEqual(['shop', 't1', null, 'p1', 'Sub', 'sub', null, null])
  })

  it('updateCategory sin campos → findCategoryById', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.updateCategory(c, 'c1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT .* FROM platform_catalog\.categories/s)
  })

  it('listCategories ORDER BY display_order, name', async () => {
    const c = mockClient([])
    await repo.listCategories(c)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY display_order, name/)
  })

  it('deleteCategory → rowCount>0', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteCategory(c, 'c1')).toBe(true)
  })
})

describe('item_categories repo', () => {
  it('assignCategory usa ON CONFLICT DO NOTHING', async () => {
    const c = mockClient([])
    await repo.assignCategory(c, { appId: 'shop', tenantId: 't1', itemId: 'i1', categoryId: 'c1' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(item_id, category_id\) DO NOTHING/)
  })

  it('unassignCategory DELETE por (item, category)', async () => {
    const c = mockClient([], 1)
    expect(await repo.unassignCategory(c, { itemId: 'i1', categoryId: 'c1' })).toBe(true)
    expect(c.query.mock.calls[0][1]).toEqual(['i1', 'c1'])
  })

  it('listItemsByCategory JOIN + activeOnly + excluye borrados', async () => {
    const c = mockClient([])
    await repo.listItemsByCategory(c, 'c1', { activeOnly: true })
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/JOIN platform_catalog\.item_categories/)
    expect(sql).toMatch(/i\.deleted_at IS NULL/)
    expect(sql).toMatch(/i\.active = true/)
  })

  it('listItemCategories JOIN categories', async () => {
    const c = mockClient([])
    await repo.listItemCategories(c, 'i1')
    expect(c.query.mock.calls[0][0]).toMatch(/JOIN platform_catalog\.categories/)
  })
})
