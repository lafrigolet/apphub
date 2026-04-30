import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
}))

vi.mock('../repositories/menu.repository.js')

import * as service from '../services/menu.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/menu.repository.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID   = '11111111-1111-1111-1111-111111111111'
const MENU_ID   = '22222222-2222-2222-2222-222222222222'
const ITEM_ID   = '33333333-3333-3333-3333-333333333333'
const CAT_ID    = '44444444-4444-4444-4444-444444444444'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── createMenu ──────────────────────────────────────────────────────────────
describe('createMenu', () => {
  it('persists menu with tenant scoping', async () => {
    repo.insertMenu.mockResolvedValue({ id: MENU_ID, name: 'Lunch' })
    const result = await service.createMenu(ctx, { name: 'Lunch' })
    expect(repo.insertMenu).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, name: 'Lunch',
    }))
    expect(result).toEqual({ id: MENU_ID, name: 'Lunch' })
  })

  it('passes subTenantId through', async () => {
    const SUB = '55555555-5555-5555-5555-555555555555'
    repo.insertMenu.mockResolvedValue({ id: MENU_ID })
    await service.createMenu({ ...ctx, subTenantId: SUB }, { name: 'Brunch' })
    expect(repo.insertMenu).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ subTenantId: SUB }))
  })
})

// ── getMenu ─────────────────────────────────────────────────────────────────
describe('getMenu', () => {
  it('returns menu with categories and items', async () => {
    repo.findMenuById.mockResolvedValue({ id: MENU_ID, name: 'Lunch' })
    repo.listCategoriesByMenu.mockResolvedValue([{ id: CAT_ID, name: 'Mains' }])
    repo.listItemsByCategory.mockResolvedValue([{ id: ITEM_ID, name: 'Burger' }])

    const result = await service.getMenu(ctx, MENU_ID)
    expect(result).toEqual({
      id: MENU_ID, name: 'Lunch',
      categories: [{ id: CAT_ID, name: 'Mains', items: [{ id: ITEM_ID, name: 'Burger' }] }],
    })
  })

  it('throws NotFoundError when menu does not exist', async () => {
    repo.findMenuById.mockResolvedValue(null)
    await expect(service.getMenu(ctx, MENU_ID)).rejects.toThrow(NotFoundError)
    expect(repo.listCategoriesByMenu).not.toHaveBeenCalled()
  })
})

// ── listAvailableItems ──────────────────────────────────────────────────────
describe('listAvailableItems', () => {
  it('delegates to repository', async () => {
    repo.listAvailableItems.mockResolvedValue([{ id: ITEM_ID, sku: 'X' }])
    const result = await service.listAvailableItems(ctx, MENU_ID)
    expect(repo.listAvailableItems).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, MENU_ID)
    expect(result).toHaveLength(1)
  })
})

// ── createItem / createCategory ─────────────────────────────────────────────
describe('createCategory / createItem', () => {
  it('createCategory injects tenant scope', async () => {
    repo.insertCategory.mockResolvedValue({ id: CAT_ID })
    await service.createCategory(ctx, { menuId: MENU_ID, name: 'Mains', courseType: 'main' })
    expect(repo.insertCategory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, menuId: MENU_ID, courseType: 'main',
    }))
  })

  it('createItem injects tenant scope', async () => {
    repo.insertItem.mockResolvedValue({ id: ITEM_ID })
    await service.createItem(ctx, { categoryId: CAT_ID, sku: 'BURG-1', name: 'Burger', priceCents: 1000 })
    expect(repo.insertItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, sku: 'BURG-1', priceCents: 1000,
    }))
  })
})

// ── updateItem ──────────────────────────────────────────────────────────────
describe('updateItem', () => {
  it('updates item and returns it', async () => {
    repo.updateItem.mockResolvedValue({ id: ITEM_ID, price_cents: 1500 })
    const result = await service.updateItem(ctx, ITEM_ID, { priceCents: 1500 })
    expect(repo.updateItem).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ITEM_ID, { priceCents: 1500 })
    expect(result.price_cents).toBe(1500)
  })

  it('throws NotFoundError when item does not exist', async () => {
    repo.updateItem.mockResolvedValue(null)
    await expect(service.updateItem(ctx, ITEM_ID, { priceCents: 100 })).rejects.toThrow(NotFoundError)
  })
})

// ── eightySix flow ──────────────────────────────────────────────────────────
describe('eightySixItem / unEightySixItem', () => {
  it('marks item 86ed and publishes event', async () => {
    repo.setEightySixed.mockResolvedValue({ id: ITEM_ID, sku: 'BURG-1' })
    const result = await service.eightySixItem(ctx, ITEM_ID)
    expect(repo.setEightySixed).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ITEM_ID, true)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'menu.item.eighty_sixed',
      payload: expect.objectContaining({ itemId: ITEM_ID, sku: 'BURG-1', tenantId: TENANT_ID }),
    }))
    expect(result.sku).toBe('BURG-1')
  })

  it('throws NotFoundError when item does not exist', async () => {
    repo.setEightySixed.mockResolvedValue(null)
    await expect(service.eightySixItem(ctx, ITEM_ID)).rejects.toThrow(NotFoundError)
    expect(publish).not.toHaveBeenCalled()
  })

  it('unEightySix publishes menu.item.restored', async () => {
    repo.setEightySixed.mockResolvedValue({ id: ITEM_ID, sku: 'BURG-1' })
    await service.unEightySixItem(ctx, ITEM_ID)
    expect(repo.setEightySixed).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ITEM_ID, false)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'menu.item.restored' }))
  })
})

// ── publishMenu ─────────────────────────────────────────────────────────────
describe('publishMenu', () => {
  it('publishes menu.published event with menu name', async () => {
    repo.findMenuById.mockResolvedValue({ id: MENU_ID, name: 'Lunch' })
    repo.listCategoriesByMenu.mockResolvedValue([])
    repo.listItemsByCategory.mockResolvedValue([])
    await service.publishMenu(ctx, MENU_ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'menu.published',
      payload: expect.objectContaining({ menuId: MENU_ID, name: 'Lunch' }),
    }))
  })
})

// ── createAvailabilityWindow ────────────────────────────────────────────────
describe('createAvailabilityWindow', () => {
  it('persists with tenant scope', async () => {
    repo.insertAvailabilityWindow.mockResolvedValue({ id: 'w1' })
    await service.createAvailabilityWindow(ctx, {
      scopeType: 'menu', scopeId: MENU_ID, daysOfWeek: [1, 2, 3], startMinute: 480, endMinute: 720,
    })
    expect(repo.insertAvailabilityWindow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, scopeType: 'menu', startMinute: 480,
    }))
  })
})
