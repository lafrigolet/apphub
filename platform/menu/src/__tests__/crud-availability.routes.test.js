// Routes for the new prioritised endpoints: PATCH/DELETE menus & categories,
// DELETE item, available-now, availability-window list/update/delete, allergen
// catalog, and the controlled-vocabulary allergen validation on item create.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/menu.service.js', () => ({
  createMenu: vi.fn(), listMenus: vi.fn(), getMenu: vi.fn(),
  updateMenu: vi.fn(), deleteMenu: vi.fn(), publishMenu: vi.fn(),
  listAvailableItems: vi.fn(), listItemsAvailableNow: vi.fn(),
  createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn(),
  createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
  eightySixItem: vi.fn(), unEightySixItem: vi.fn(),
  createAvailabilityWindow: vi.fn(), listAvailabilityWindows: vi.fn(),
  updateAvailabilityWindow: vi.fn(), deleteAvailabilityWindow: vi.fn(),
}))

import { menuRoutes } from '../routes/menu.routes.js'
import * as service from '../services/menu.service.js'

const IDENTITY = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'admin' }

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = IDENTITY })
  await app.register(menuRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const MENU_ID = '22222222-2222-2222-2222-222222222222'
const CAT_ID = '44444444-4444-4444-4444-444444444444'
const ITEM_ID = '33333333-3333-3333-3333-333333333333'
const WIN_ID = '55555555-5555-5555-5555-555555555555'
const json = { 'Content-Type': 'application/json' }

describe('PATCH/DELETE /v1/menu/menus/:id', () => {
  it('PATCH delegates updateMenu', async () => {
    service.updateMenu.mockResolvedValue({ id: MENU_ID, name: 'New' })
    const res = await app.inject({ method: 'PATCH', url: `/v1/menu/menus/${MENU_ID}`, headers: json, payload: { name: 'New' } })
    expect(res.statusCode).toBe(200)
    expect(service.updateMenu).toHaveBeenCalledWith(expect.anything(), MENU_ID, { name: 'New' })
  })
  it('empty patch rejected by zod', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/menu/menus/${MENU_ID}`, headers: json, payload: {} })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.updateMenu).not.toHaveBeenCalled()
  })
  it('DELETE delegates deleteMenu', async () => {
    service.deleteMenu.mockResolvedValue({ id: MENU_ID, deleted: true })
    const res = await app.inject({ method: 'DELETE', url: `/v1/menu/menus/${MENU_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.deleteMenu).toHaveBeenCalledWith(expect.anything(), MENU_ID)
  })
})

describe('PATCH/DELETE /v1/menu/categories/:id', () => {
  it('PATCH delegates updateCategory', async () => {
    service.updateCategory.mockResolvedValue({ id: CAT_ID })
    const res = await app.inject({ method: 'PATCH', url: `/v1/menu/categories/${CAT_ID}`, headers: json, payload: { courseType: 'dessert' } })
    expect(res.statusCode).toBe(200)
    expect(service.updateCategory).toHaveBeenCalledWith(expect.anything(), CAT_ID, { courseType: 'dessert' })
  })
  it('invalid courseType rejected', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/menu/categories/${CAT_ID}`, headers: json, payload: { courseType: 'NOPE' } })
    expect([400, 500]).toContain(res.statusCode)
  })
  it('DELETE delegates deleteCategory', async () => {
    service.deleteCategory.mockResolvedValue({ id: CAT_ID, deleted: true })
    const res = await app.inject({ method: 'DELETE', url: `/v1/menu/categories/${CAT_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.deleteCategory).toHaveBeenCalledWith(expect.anything(), CAT_ID)
  })
})

describe('DELETE /v1/menu/items/:id', () => {
  it('delegates deleteItem', async () => {
    service.deleteItem.mockResolvedValue({ id: ITEM_ID, deleted: true })
    const res = await app.inject({ method: 'DELETE', url: `/v1/menu/items/${ITEM_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.deleteItem).toHaveBeenCalledWith(expect.anything(), ITEM_ID)
  })
})

describe('item create allergen vocabulary (EU 1169/2011)', () => {
  it('accepts valid allergen codes', async () => {
    service.createItem.mockResolvedValue({ id: ITEM_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/items', headers: json,
      payload: { categoryId: CAT_ID, sku: 'X', name: 'N', priceCents: 100, allergens: ['gluten', 'milk'] },
    })
    expect(res.statusCode).toBe(201)
  })
  it('rejects unknown allergen code', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/items', headers: json,
      payload: { categoryId: CAT_ID, sku: 'X', name: 'N', priceCents: 100, allergens: ['kryptonite'] },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createItem).not.toHaveBeenCalled()
  })
})

describe('PATCH /v1/menu/items/:id move', () => {
  it('allows categoryId in patch to move item', async () => {
    service.updateItem.mockResolvedValue({ id: ITEM_ID })
    const res = await app.inject({ method: 'PATCH', url: `/v1/menu/items/${ITEM_ID}`, headers: json, payload: { categoryId: CAT_ID } })
    expect(res.statusCode).toBe(200)
    expect(service.updateItem).toHaveBeenCalledWith(expect.anything(), ITEM_ID, { categoryId: CAT_ID })
  })
})

describe('GET /v1/menu/menus/:id/available-now', () => {
  it('delegates with optional at param', async () => {
    service.listItemsAvailableNow.mockResolvedValue([{ id: ITEM_ID }])
    const res = await app.inject({ method: 'GET', url: `/v1/menu/menus/${MENU_ID}/available-now?at=2026-06-04T10:00:00Z` })
    expect(res.statusCode).toBe(200)
    expect(service.listItemsAvailableNow).toHaveBeenCalledWith(expect.anything(), MENU_ID, '2026-06-04T10:00:00Z')
  })
})

describe('availability-windows list/update/delete', () => {
  it('GET delegates with scope filter', async () => {
    service.listAvailabilityWindows.mockResolvedValue([{ id: WIN_ID }])
    const res = await app.inject({ method: 'GET', url: `/v1/menu/availability-windows?scopeType=item&scopeId=${ITEM_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.listAvailabilityWindows).toHaveBeenCalledWith(expect.anything(), { scopeType: 'item', scopeId: ITEM_ID })
  })
  it('PATCH delegates updateAvailabilityWindow', async () => {
    service.updateAvailabilityWindow.mockResolvedValue({ id: WIN_ID })
    const res = await app.inject({ method: 'PATCH', url: `/v1/menu/availability-windows/${WIN_ID}`, headers: json, payload: { startMinute: 60 } })
    expect(res.statusCode).toBe(200)
    expect(service.updateAvailabilityWindow).toHaveBeenCalledWith(expect.anything(), WIN_ID, { startMinute: 60 })
  })
  it('DELETE delegates deleteAvailabilityWindow', async () => {
    service.deleteAvailabilityWindow.mockResolvedValue({ id: WIN_ID, deleted: true })
    const res = await app.inject({ method: 'DELETE', url: `/v1/menu/availability-windows/${WIN_ID}` })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /v1/menu/allergens', () => {
  it('returns the 14 EU allergen codes', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/menu/allergens' })
    expect(res.statusCode).toBe(200)
    expect(res.json().allergens).toHaveLength(14)
    expect(res.json().allergens).toContain('gluten')
  })
})
