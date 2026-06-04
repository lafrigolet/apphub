// Tests for the prioritised use-cases added on top of the menu module:
//   1. CRUD completo de carta — PATCH/DELETE menus + PATCH/DELETE categorías + DELETE ítem
//   2. Motor available-now — GET /menus/:id/available-now (evalúa ventanas)
//   3. Vocabulario controlado de alérgenos (EU 1169/2011)
//   + list/update/delete de availability windows, move item, lifecycle events.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))

import * as repo from '../repositories/menu.repository.js'
import * as service from '../services/menu.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

const APP = 'demo-restaurant'
const TEN = '22222222-2222-2222-2222-222222222222'
const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── Repository: updateMenu / softDeleteMenu ──────────────────────────────────
describe('repo.updateMenu', () => {
  it('builds dynamic UPDATE scoped + filters deleted_at, snake_case columns', async () => {
    const c = mockClient([{ id: 'm1' }])
    await repo.updateMenu(c, APP, TEN, 'm1', { name: 'X', isActive: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_menu\.menus SET name = \$4, is_active = \$5/)
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(params).toEqual([APP, TEN, 'm1', 'X', false])
  })

  it('empty patch delegates to findMenuById', async () => {
    const c = mockClient([{ id: 'm1' }])
    const r = await repo.updateMenu(c, APP, TEN, 'm1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_menu\.menus/)
    expect(r).toEqual({ id: 'm1' })
  })
})

describe('repo.softDeleteMenu', () => {
  it('sets deleted_at scoped; missing row → null', async () => {
    const c = mockClient([{ id: 'm1' }])
    const r = await repo.softDeleteMenu(c, APP, TEN, 'm1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET deleted_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'm1'])
    expect(r).toEqual({ id: 'm1' })
    expect(await repo.softDeleteMenu(mockClient([]), APP, TEN, 'gone')).toBeNull()
  })
})

// ── Repository: updateCategory / softDeleteCategory (cascade) ─────────────────
describe('repo.updateCategory', () => {
  it('maps name/courseType/displayOrder', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.updateCategory(c, APP, TEN, 'c1', { name: 'N', courseType: 'dessert', displayOrder: 3 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/course_type = /)
    expect(params).toEqual([APP, TEN, 'c1', 'N', 'dessert', 3])
  })
})

describe('repo.softDeleteCategory', () => {
  it('soft-deletes category then cascades to its items', async () => {
    const c = { query: vi.fn() }
    c.query.mockResolvedValueOnce({ rows: [{ id: 'c1' }] }) // category delete
    c.query.mockResolvedValueOnce({ rows: [] })             // items cascade
    const r = await repo.softDeleteCategory(c, APP, TEN, 'c1')
    expect(r).toEqual({ id: 'c1' })
    expect(c.query).toHaveBeenCalledTimes(2)
    expect(c.query.mock.calls[1][0]).toMatch(/UPDATE platform_menu\.menu_items SET deleted_at/)
    expect(c.query.mock.calls[1][0]).toMatch(/category_id=\$3/)
  })

  it('missing category → null, no cascade', async () => {
    const c = mockClient([])
    expect(await repo.softDeleteCategory(c, APP, TEN, 'gone')).toBeNull()
    expect(c.query).toHaveBeenCalledTimes(1)
  })
})

// ── Repository: softDeleteItem + move (categoryId in updateItem) ──────────────
describe('repo.updateItem move + softDeleteItem', () => {
  it('updateItem can move item to another category', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.updateItem(c, APP, TEN, 'i1', { categoryId: 'c2' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/category_id = \$4/)
    expect(params).toEqual([APP, TEN, 'i1', 'c2'])
  })

  it('softDeleteItem scoped; missing → null', async () => {
    const c = mockClient([{ id: 'i1', sku: 'S' }])
    expect(await repo.softDeleteItem(c, APP, TEN, 'i1')).toEqual({ id: 'i1', sku: 'S' })
    expect(await repo.softDeleteItem(mockClient([]), APP, TEN, 'g')).toBeNull()
  })
})

// ── Repository: available-now engine SQL ─────────────────────────────────────
describe('repo.listItemsAvailableNow', () => {
  it('joins windows per scope and passes dow + minute params', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.listItemsAvailableNow(c, APP, TEN, 'm1', 3, 600)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/availability_windows/)
    expect(sql).toMatch(/wm\.n IS NULL OR wm\.open_now/)
    expect(sql).toMatch(/wc\.n IS NULL OR wc\.open_now/)
    expect(sql).toMatch(/wi\.n IS NULL OR wi\.open_now/)
    expect(params).toEqual([APP, TEN, 'm1', null, 3, 600])
  })
})

// ── Repository: availability window list/update/delete ───────────────────────
describe('repo availability windows CRUD', () => {
  it('list with no filter is scoped only by app/tenant', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.listAvailabilityWindows(c, APP, TEN)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN])
  })

  it('list with scope filter adds predicates', async () => {
    const c = mockClient([])
    await repo.listAvailabilityWindows(c, APP, TEN, { scopeType: 'item', scopeId: 'i1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/scope_type=\$3/)
    expect(sql).toMatch(/scope_id=\$4/)
    expect(params).toEqual([APP, TEN, 'item', 'i1'])
  })

  it('update maps days/minutes/label', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.updateAvailabilityWindow(c, APP, TEN, 'w1', { startMinute: 60, label: 'lunch' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/start_minute = \$4/)
    expect(params).toEqual([APP, TEN, 'w1', 60, 'lunch'])
  })

  it('delete is scoped and returns the row', async () => {
    const c = mockClient([{ id: 'w1' }])
    const r = await repo.deleteAvailabilityWindow(c, APP, TEN, 'w1')
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_menu\.availability_windows/)
    expect(r).toEqual({ id: 'w1' })
  })
})

// ── Service: menu/category/item CRUD ─────────────────────────────────────────
describe('service.updateMenu / deleteMenu', () => {
  it('updateMenu returns row', async () => {
    vi.spyOn(repo, 'updateMenu').mockResolvedValue({ id: 'm1', name: 'New' })
    expect(await service.updateMenu(ctx, 'm1', { name: 'New' })).toEqual({ id: 'm1', name: 'New' })
  })
  it('updateMenu missing → NotFoundError', async () => {
    vi.spyOn(repo, 'updateMenu').mockResolvedValue(null)
    await expect(service.updateMenu(ctx, 'm1', { name: 'X' })).rejects.toThrow(NotFoundError)
  })
  it('deleteMenu returns marker; missing → NotFoundError', async () => {
    vi.spyOn(repo, 'softDeleteMenu').mockResolvedValue({ id: 'm1' })
    expect(await service.deleteMenu(ctx, 'm1')).toEqual({ id: 'm1', deleted: true })
    vi.spyOn(repo, 'softDeleteMenu').mockResolvedValue(null)
    await expect(service.deleteMenu(ctx, 'm1')).rejects.toThrow(NotFoundError)
  })
})

describe('service.updateCategory / deleteCategory', () => {
  it('updateCategory missing → NotFoundError', async () => {
    vi.spyOn(repo, 'updateCategory').mockResolvedValue(null)
    await expect(service.updateCategory(ctx, 'c1', { name: 'X' })).rejects.toThrow(NotFoundError)
  })
  it('deleteCategory returns marker', async () => {
    vi.spyOn(repo, 'softDeleteCategory').mockResolvedValue({ id: 'c1' })
    expect(await service.deleteCategory(ctx, 'c1')).toEqual({ id: 'c1', deleted: true })
  })
})

// ── Service: item lifecycle events ───────────────────────────────────────────
describe('service item lifecycle events', () => {
  it('createItem publishes menu.item.created', async () => {
    vi.spyOn(repo, 'insertItem').mockResolvedValue({ id: 'i1', sku: 'S' })
    await service.createItem(ctx, { categoryId: 'c1', sku: 'S', name: 'N', priceCents: 100 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'menu.item.created', payload: expect.objectContaining({ itemId: 'i1', sku: 'S' }),
    }))
  })

  it('updateItem publishes menu.item.updated', async () => {
    vi.spyOn(repo, 'updateItem').mockResolvedValue({ id: 'i1', sku: 'S' })
    await service.updateItem(ctx, 'i1', { priceCents: 200 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'menu.item.updated' }))
  })

  it('deleteItem publishes menu.item.deleted; missing → NotFoundError + no event', async () => {
    vi.spyOn(repo, 'softDeleteItem').mockResolvedValue({ id: 'i1', sku: 'S' })
    expect(await service.deleteItem(ctx, 'i1')).toEqual({ id: 'i1', deleted: true })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'menu.item.deleted' }))
    vi.clearAllMocks()
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
    vi.spyOn(repo, 'softDeleteItem').mockResolvedValue(null)
    await expect(service.deleteItem(ctx, 'gone')).rejects.toThrow(NotFoundError)
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── Service: available-now ───────────────────────────────────────────────────
describe('service.listItemsAvailableNow', () => {
  it('computes UTC dow + minute-of-day and delegates', async () => {
    vi.spyOn(repo, 'findMenuById').mockResolvedValue({ id: 'm1' })
    const spy = vi.spyOn(repo, 'listItemsAvailableNow').mockResolvedValue([{ id: 'i1' }])
    // 2026-06-04T10:30:00Z → Thursday (dow=4), minute = 630
    const r = await service.listItemsAvailableNow(ctx, 'm1', '2026-06-04T10:30:00Z')
    expect(r).toEqual([{ id: 'i1' }])
    expect(spy).toHaveBeenCalledWith(expect.anything(), APP, TEN, 'm1', 4, 630)
  })

  it('unknown menu → NotFoundError', async () => {
    vi.spyOn(repo, 'findMenuById').mockResolvedValue(null)
    await expect(service.listItemsAvailableNow(ctx, 'm1', '2026-06-04T10:00:00Z')).rejects.toThrow(NotFoundError)
  })

  it('invalid timestamp → ValidationError', async () => {
    await expect(service.listItemsAvailableNow(ctx, 'm1', 'not-a-date')).rejects.toThrow(ValidationError)
  })
})

// ── Service: availability windows list/update/delete ─────────────────────────
describe('service availability windows', () => {
  it('updateAvailabilityWindow missing → NotFoundError', async () => {
    vi.spyOn(repo, 'updateAvailabilityWindow').mockResolvedValue(null)
    await expect(service.updateAvailabilityWindow(ctx, 'w1', { label: 'x' })).rejects.toThrow(NotFoundError)
  })
  it('deleteAvailabilityWindow returns marker', async () => {
    vi.spyOn(repo, 'deleteAvailabilityWindow').mockResolvedValue({ id: 'w1' })
    expect(await service.deleteAvailabilityWindow(ctx, 'w1')).toEqual({ id: 'w1', deleted: true })
  })
})
