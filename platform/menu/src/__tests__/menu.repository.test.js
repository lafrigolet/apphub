// menu.repository — SQL shape de platform_menu.* (menus, categories, items,
// availability windows). Valida proyección de columnas, scoping (app_id+tenant_id),
// params parametrizados, COALESCE de defaults y el builder dinámico de updateItem.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/menu.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'aikikan'
const TEN = 't1'

describe('insertMenu', () => {
  it('INSERT en platform_menu.menus con scoping + COALESCE is_active', async () => {
    const c = mockClient([{ id: 'm1' }])
    const r = await repo.insertMenu(c, { appId: APP, tenantId: TEN, name: 'Lunch' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_menu\.menus/)
    expect(sql).toMatch(/COALESCE\(\$6,TRUE\)/)
    expect(params).toEqual([APP, TEN, null, 'Lunch', null, true])
    expect(r).toEqual({ id: 'm1' })
  })

  it('respeta subTenantId, description e isActive explícitos', async () => {
    const c = mockClient([{ id: 'm1' }])
    await repo.insertMenu(c, {
      appId: APP, tenantId: TEN, subTenantId: 's1', name: 'Cena',
      description: 'desc', isActive: false,
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'Cena', 'desc', false])
  })
})

describe('listMenus', () => {
  it('SELECT scoped + ORDER BY created_at DESC', async () => {
    const c = mockClient([{ id: 'm1' }])
    const r = await repo.listMenus(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_menu\.menus WHERE app_id=\$1 AND tenant_id=\$2/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([APP, TEN])
    expect(r).toEqual([{ id: 'm1' }])
  })
})

describe('findMenuById', () => {
  it('WHERE app_id+tenant_id+id; row → objeto', async () => {
    const c = mockClient([{ id: 'm1' }])
    expect(await repo.findMenuById(c, APP, TEN, 'm1')).toEqual({ id: 'm1' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'm1'])
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findMenuById(c, APP, TEN, 'gh')).toBeNull()
  })
})

describe('insertCategory', () => {
  it('INSERT scoped + COALESCE display_order 0', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.insertCategory(c, { appId: APP, tenantId: TEN, menuId: 'm1', name: 'Mains', courseType: 'main' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_menu\.menu_categories/)
    expect(params).toEqual([APP, TEN, 'm1', 'Mains', 'main', 0])
  })

  it('respeta displayOrder explícito', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.insertCategory(c, { appId: APP, tenantId: TEN, menuId: 'm1', name: 'X', courseType: 'main', displayOrder: 5 })
    expect(c.query.mock.calls[0][1][5]).toBe(5)
  })
})

describe('listCategoriesByMenu', () => {
  it('SELECT scoped por menu + ORDER BY display_order,name', async () => {
    const c = mockClient([{ id: 'c1' }])
    const r = await repo.listCategoriesByMenu(c, APP, TEN, 'm1')
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY display_order, name/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'm1'])
    expect(r).toEqual([{ id: 'c1' }])
  })
})

describe('insertItem', () => {
  it('INSERT con defaults COALESCE (EUR/main/availability/arrays/jsonb)', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.insertItem(c, {
      appId: APP, tenantId: TEN, categoryId: 'c1', sku: 'BURG', name: 'Burger', priceCents: 1000,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_menu\.menu_items/)
    expect(sql).toMatch(/COALESCE\(\$8,'EUR'\)/)
    expect(params).toEqual([
      APP, TEN, 'c1', 'BURG', 'Burger', null, 1000, 'EUR', 'main', null, null,
      [], [], null, null, true, {},
    ])
  })

  it('respeta todos los campos opcionales explícitos', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.insertItem(c, {
      appId: APP, tenantId: TEN, categoryId: 'c1', sku: 'BURG', name: 'Burger',
      description: 'd', priceCents: 1000, currency: 'USD', courseType: 'starter',
      station: 'grill', prepTimeSeconds: 300, allergens: ['gluten'], badges: ['new'],
      photoUrl: 'http://x/p.png', photoObjectId: 'o1', isAvailable: false, metadata: { k: 1 },
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, 'c1', 'BURG', 'Burger', 'd', 1000, 'USD', 'starter', 'grill', 300,
      ['gluten'], ['new'], 'http://x/p.png', 'o1', false, { k: 1 },
    ])
  })
})

describe('findItemById', () => {
  it('row → objeto; sin row → null', async () => {
    expect(await repo.findItemById(mockClient([{ id: 'i1' }]), APP, TEN, 'i1')).toEqual({ id: 'i1' })
    expect(await repo.findItemById(mockClient([]), APP, TEN, 'gh')).toBeNull()
  })
})

describe('listItemsByCategory', () => {
  it('SELECT scoped por category + ORDER BY name', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.listItemsByCategory(c, APP, TEN, 'c1')
    expect(c.query.mock.calls[0][0]).toMatch(/category_id=\$3[\s\S]*ORDER BY name/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'c1'])
  })
})

describe('listAvailableItems', () => {
  it('JOIN categorías, filtra is_available + NOT eighty_sixed', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.listAvailableItems(c, APP, TEN, 'm1')
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/JOIN platform_menu\.menu_categories/)
    expect(sql).toMatch(/i\.is_available = TRUE AND i\.eighty_sixed = FALSE/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'm1'])
  })
})

describe('setEightySixed', () => {
  it('UPDATE eighty_sixed con valor + scoping; row → objeto', async () => {
    const c = mockClient([{ id: 'i1', eighty_sixed: true }])
    const r = await repo.setEightySixed(c, APP, TEN, 'i1', true)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET eighty_sixed = \$4, updated_at = now\(\)/)
    expect(params).toEqual([APP, TEN, 'i1', true])
    expect(r).toEqual({ id: 'i1', eighty_sixed: true })
  })

  it('sin row → null', async () => {
    expect(await repo.setEightySixed(mockClient([]), APP, TEN, 'gh', false)).toBeNull()
  })
})

describe('updateItem — builder dinámico', () => {
  it('mapea solo campos definidos a columnas snake_case + updated_at', async () => {
    const c = mockClient([{ id: 'i1' }])
    const r = await repo.updateItem(c, APP, TEN, 'i1', { priceCents: 1500, isAvailable: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/price_cents = \$4/)
    expect(sql).toMatch(/is_available = \$5/)
    expect(sql).toMatch(/updated_at = now\(\)/)
    expect(params).toEqual([APP, TEN, 'i1', 1500, false])
    expect(r).toEqual({ id: 'i1' })
  })

  it('mapea name/description/allergens/badges/photo/station/prep/course', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.updateItem(c, APP, TEN, 'i1', {
      name: 'N', description: 'D', allergens: ['x'], badges: ['y'],
      photoUrl: 'u', photoObjectId: 'o', station: 'st', prepTimeSeconds: 60, courseType: 'dessert',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/course_type = /)
    expect(params).toEqual([
      APP, TEN, 'i1', 'N', 'D', ['x'], ['y'], 'u', 'o', 'st', 60, 'dessert',
    ])
  })

  it('patch vacío → no UPDATE, delega en findItemById', async () => {
    const c = mockClient([{ id: 'i1' }])
    const r = await repo.updateItem(c, APP, TEN, 'i1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_menu\.menu_items WHERE/)
    expect(r).toEqual({ id: 'i1' })
  })

  it('row inexistente tras UPDATE → null', async () => {
    const c = mockClient([])
    expect(await repo.updateItem(c, APP, TEN, 'gh', { priceCents: 1 })).toBeNull()
  })
})

describe('insertAvailabilityWindow', () => {
  it('INSERT scoped con label default null', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertAvailabilityWindow(c, {
      appId: APP, tenantId: TEN, scopeType: 'menu', scopeId: 'm1',
      daysOfWeek: [1, 2], startMinute: 480, endMinute: 720,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_menu\.availability_windows/)
    expect(params).toEqual([APP, TEN, 'menu', 'm1', [1, 2], 480, 720, null])
  })

  it('respeta label explícito', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertAvailabilityWindow(c, {
      appId: APP, tenantId: TEN, scopeType: 'item', scopeId: 'i1',
      daysOfWeek: [0], startMinute: 0, endMinute: 1440, label: 'all-day',
    })
    expect(c.query.mock.calls[0][1][7]).toBe('all-day')
  })
})
