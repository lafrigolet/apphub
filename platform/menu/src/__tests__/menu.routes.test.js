// menu.routes — wiring HTTP → service. Verifica status codes (201 en creates),
// delegación con ctx derivado de req.identity, parsing de params y validación zod.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/menu.service.js', () => ({
  createMenu:               vi.fn(),
  listMenus:                vi.fn(),
  getMenu:                  vi.fn(),
  publishMenu:              vi.fn(),
  listAvailableItems:       vi.fn(),
  createCategory:           vi.fn(),
  createItem:               vi.fn(),
  updateItem:               vi.fn(),
  eightySixItem:            vi.fn(),
  unEightySixItem:          vi.fn(),
  createAvailabilityWindow: vi.fn(),
}))

import { menuRoutes } from '../routes/menu.routes.js'
import * as service from '../services/menu.service.js'

const IDENTITY = {
  appId: 'aikikan', tenantId: 't1', subTenantId: null,
  userId: 'u1', role: 'admin',
}

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
const CAT_ID  = '44444444-4444-4444-4444-444444444444'
const ITEM_ID = '33333333-3333-3333-3333-333333333333'

describe('POST /v1/menu/menus', () => {
  it('201 + delega createMenu con ctx de identity', async () => {
    service.createMenu.mockResolvedValue({ id: MENU_ID, name: 'Lunch' })
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/menus',
      headers: { 'Content-Type': 'application/json' },
      payload: { name: 'Lunch' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('Lunch')
    expect(service.createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1', userId: 'u1', role: 'admin' }),
      { name: 'Lunch' },
    )
  })

  it('body inválido → error de zod (500 vía errorHandler)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/menus',
      headers: { 'Content-Type': 'application/json' },
      payload: { name: '' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createMenu).not.toHaveBeenCalled()
  })
})

describe('GET /v1/menu/menus', () => {
  it('lista menus', async () => {
    service.listMenus.mockResolvedValue([{ id: MENU_ID }])
    const res = await app.inject({ method: 'GET', url: '/v1/menu/menus' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: MENU_ID }])
    expect(service.listMenus).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }))
  })
})

describe('GET /v1/menu/menus/:id', () => {
  it('delega getMenu con el id del path', async () => {
    service.getMenu.mockResolvedValue({ id: MENU_ID, categories: [] })
    const res = await app.inject({ method: 'GET', url: `/v1/menu/menus/${MENU_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getMenu).toHaveBeenCalledWith(expect.anything(), MENU_ID)
  })
})

describe('POST /v1/menu/menus/:id/publish', () => {
  it('delega publishMenu', async () => {
    service.publishMenu.mockResolvedValue({ id: MENU_ID })
    const res = await app.inject({ method: 'POST', url: `/v1/menu/menus/${MENU_ID}/publish` })
    expect(res.statusCode).toBe(200)
    expect(service.publishMenu).toHaveBeenCalledWith(expect.anything(), MENU_ID)
  })
})

describe('GET /v1/menu/menus/:id/items', () => {
  it('delega listAvailableItems', async () => {
    service.listAvailableItems.mockResolvedValue([{ id: ITEM_ID }])
    const res = await app.inject({ method: 'GET', url: `/v1/menu/menus/${MENU_ID}/items` })
    expect(res.statusCode).toBe(200)
    expect(service.listAvailableItems).toHaveBeenCalledWith(expect.anything(), MENU_ID)
  })
})

describe('POST /v1/menu/categories', () => {
  it('201 + delega createCategory', async () => {
    service.createCategory.mockResolvedValue({ id: CAT_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/categories',
      headers: { 'Content-Type': 'application/json' },
      payload: { menuId: MENU_ID, name: 'Mains', courseType: 'main' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createCategory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ menuId: MENU_ID, courseType: 'main' }),
    )
  })

  it('courseType inválido → rechazado', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/categories',
      headers: { 'Content-Type': 'application/json' },
      payload: { menuId: MENU_ID, name: 'Mains', courseType: 'NOPE' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createCategory).not.toHaveBeenCalled()
  })
})

describe('POST /v1/menu/items', () => {
  it('201 + delega createItem', async () => {
    service.createItem.mockResolvedValue({ id: ITEM_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/items',
      headers: { 'Content-Type': 'application/json' },
      payload: { categoryId: CAT_ID, sku: 'BURG', name: 'Burger', priceCents: 1000 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sku: 'BURG', priceCents: 1000 }),
    )
  })
})

describe('PATCH /v1/menu/items/:id', () => {
  it('delega updateItem con patch', async () => {
    service.updateItem.mockResolvedValue({ id: ITEM_ID, price_cents: 1500 })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/menu/items/${ITEM_ID}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { priceCents: 1500 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateItem).toHaveBeenCalledWith(expect.anything(), ITEM_ID, { priceCents: 1500 })
  })
})

describe('eighty-six / restore', () => {
  it('POST /eighty-six delega eightySixItem', async () => {
    service.eightySixItem.mockResolvedValue({ id: ITEM_ID })
    const res = await app.inject({ method: 'POST', url: `/v1/menu/items/${ITEM_ID}/eighty-six` })
    expect(res.statusCode).toBe(200)
    expect(service.eightySixItem).toHaveBeenCalledWith(expect.anything(), ITEM_ID)
  })

  it('POST /restore delega unEightySixItem', async () => {
    service.unEightySixItem.mockResolvedValue({ id: ITEM_ID })
    const res = await app.inject({ method: 'POST', url: `/v1/menu/items/${ITEM_ID}/restore` })
    expect(res.statusCode).toBe(200)
    expect(service.unEightySixItem).toHaveBeenCalledWith(expect.anything(), ITEM_ID)
  })
})

describe('POST /v1/menu/availability-windows', () => {
  it('201 + delega createAvailabilityWindow', async () => {
    service.createAvailabilityWindow.mockResolvedValue({ id: 'w1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/availability-windows',
      headers: { 'Content-Type': 'application/json' },
      payload: { scopeType: 'menu', scopeId: MENU_ID, daysOfWeek: [1, 2], startMinute: 480, endMinute: 720 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createAvailabilityWindow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopeType: 'menu', startMinute: 480 }),
    )
  })

  it('daysOfWeek fuera de rango → rechazado', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/menu/availability-windows',
      headers: { 'Content-Type': 'application/json' },
      payload: { scopeType: 'menu', scopeId: MENU_ID, daysOfWeek: [9], startMinute: 480, endMinute: 720 },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createAvailabilityWindow).not.toHaveBeenCalled()
  })
})
