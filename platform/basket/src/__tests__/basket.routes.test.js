// basket.routes — cubre todas las rutas: basket CRUD, merge, saved-for-later,
// summary, promo apply/clear, y promo CRUD staff-gated (requireStaff).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/basket.service.js', () => ({
  getBasket:        vi.fn(),
  getCount:         vi.fn(),
  upsertItem:       vi.fn(),
  patchQuantity:    vi.fn(),
  removeItem:       vi.fn(),
  clearBasket:      vi.fn(),
  mergeBaskets:     vi.fn(),
  listSaved:        vi.fn(),
  saveForLater:     vi.fn(),
  moveBackToBasket: vi.fn(),
  removeSaved:      vi.fn(),
}))

vi.mock('../services/promotions.service.js', () => ({
  basketSummary: vi.fn(),
  applyPromo:    vi.fn(),
  clearPromo:    vi.fn(),
  listPromos:    vi.fn(),
  upsertPromo:   vi.fn(),
  deletePromo:   vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        const auth = req.headers.authorization ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        const role = token === 'staff-token' ? 'staff'
                  : token === 'admin-token' ? 'admin'
                  : token === 'guest-token' ? 'guest'
                  : 'user'
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role }
      })
    }),
    requireRole: () => async () => {},
  }
})

import { basketRoutes } from '../routes/basket.routes.js'
import * as basketService from '../services/basket.service.js'
import * as promosService from '../services/promotions.service.js'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(basketRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
const userHdr = { Authorization: 'Bearer user-token' }
const staffHdr = { Authorization: 'Bearer staff-token' }
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('basket CRUD routes', () => {
  it('GET /v1/basket', async () => {
    basketService.getBasket.mockResolvedValue({ items: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: userHdr })
    expect(res.statusCode).toBe(200)
    expect(basketService.getBasket).toHaveBeenCalledWith({ appId: 'aikikan', tenantId: 't1', userId: 'u1' })
  })

  it('GET /v1/basket/count', async () => {
    basketService.getCount.mockResolvedValue({ itemCount: 3, lineCount: 2, subtotalCents: 500, appliedPromo: null })
    const res = await app.inject({ method: 'GET', url: '/v1/basket/count', headers: userHdr })
    expect(res.statusCode).toBe(200)
    expect(res.json().itemCount).toBe(3)
    expect(basketService.getCount).toHaveBeenCalledWith({ appId: 'aikikan', tenantId: 't1', userId: 'u1' })
  })

  it('PUT /v1/basket/items', async () => {
    basketService.upsertItem.mockResolvedValue({ items: [{ itemId: 'p1' }] })
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { itemId: 'p1', quantity: 2, name: 'X', priceCents: 100 },
    })
    expect(res.statusCode).toBe(200)
    expect(basketService.upsertItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'p1', quantity: 2, isGuest: false }))
  })

  it('PATCH /v1/basket/items/:itemId/quantity', async () => {
    basketService.patchQuantity.mockResolvedValue({ items: [{ itemId: 'p1', quantity: 5 }] })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/basket/items/p1/quantity', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { delta: 3 },
    })
    expect(res.statusCode).toBe(200)
    expect(basketService.patchQuantity).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'p1', delta: 3, isGuest: false }))
  })

  it('PATCH /v1/basket/items/:itemId/quantity body inválido (delta no entero) → no llama service', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/basket/items/p1/quantity', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { delta: 1.5 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(basketService.patchQuantity).not.toHaveBeenCalled()
  })

  it('PUT /v1/basket/items body inválido → no llama service', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { itemId: '', quantity: 0 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(basketService.upsertItem).not.toHaveBeenCalled()
  })

  it('DELETE /v1/basket/items/:itemId', async () => {
    basketService.removeItem.mockResolvedValue({ items: [] })
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket/items/p1', headers: userHdr })
    expect(res.statusCode).toBe(200)
    expect(basketService.removeItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'p1', isGuest: false }))
  })

  it('PUT /v1/basket/items con rol guest → isGuest:true', async () => {
    basketService.upsertItem.mockResolvedValue({ items: [] })
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: { Authorization: 'Bearer guest-token', 'Content-Type': 'application/json' },
      payload: { itemId: 'p1', quantity: 1, name: 'X', priceCents: 100 },
    })
    expect(res.statusCode).toBe(200)
    expect(basketService.upsertItem).toHaveBeenCalledWith(expect.objectContaining({ isGuest: true }))
  })

  it('DELETE /v1/basket → 204', async () => {
    basketService.clearBasket.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket', headers: userHdr })
    expect(res.statusCode).toBe(204)
    expect(basketService.clearBasket).toHaveBeenCalled()
  })

  it('POST /v1/basket/merge', async () => {
    basketService.mergeBaskets.mockResolvedValue({ items: [] })
    const res = await app.inject({
      method: 'POST', url: '/v1/basket/merge', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { guestUserId: 'g1' },
    })
    expect(res.statusCode).toBe(200)
    expect(basketService.mergeBaskets).toHaveBeenCalledWith(expect.objectContaining({ guestUserId: 'g1' }))
  })
})

describe('saved-for-later routes', () => {
  it('GET /v1/basket/saved', async () => {
    basketService.listSaved.mockResolvedValue({ items: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/basket/saved', headers: userHdr })
    expect(res.statusCode).toBe(200)
  })

  it('POST /v1/basket/saved', async () => {
    basketService.saveForLater.mockResolvedValue({ saved: { items: [] }, basket: { items: [] } })
    const res = await app.inject({
      method: 'POST', url: '/v1/basket/saved', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { itemId: 'p1' },
    })
    expect(res.statusCode).toBe(200)
    expect(basketService.saveForLater).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'p1' }))
  })

  it('POST /v1/basket/saved/:itemId/move-back', async () => {
    basketService.moveBackToBasket.mockResolvedValue({ saved: { items: [] }, basket: { items: [] } })
    const res = await app.inject({ method: 'POST', url: '/v1/basket/saved/p1/move-back', headers: userHdr })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /v1/basket/saved/:itemId', async () => {
    basketService.removeSaved.mockResolvedValue({ items: [] })
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket/saved/p1', headers: userHdr })
    expect(res.statusCode).toBe(200)
  })
})

describe('promo per-user routes', () => {
  it('GET /v1/basket/summary con shippingCents', async () => {
    promosService.basketSummary.mockResolvedValue({ basket: {}, summary: {} })
    const res = await app.inject({ method: 'GET', url: '/v1/basket/summary?shippingCents=500', headers: userHdr })
    expect(res.statusCode).toBe(200)
    expect(promosService.basketSummary).toHaveBeenCalledWith(expect.objectContaining({ shippingCents: 500 }))
  })

  it('GET /v1/basket/summary sin query', async () => {
    promosService.basketSummary.mockResolvedValue({ basket: {}, summary: {} })
    const res = await app.inject({ method: 'GET', url: '/v1/basket/summary', headers: userHdr })
    expect(res.statusCode).toBe(200)
  })

  it('POST /v1/basket/promo', async () => {
    promosService.applyPromo.mockResolvedValue({ basket: {}, summary: {} })
    const res = await app.inject({
      method: 'POST', url: '/v1/basket/promo', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { code: 'SAVE10' },
    })
    expect(res.statusCode).toBe(200)
    expect(promosService.applyPromo).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAVE10' }))
  })

  it('DELETE /v1/basket/promo', async () => {
    promosService.clearPromo.mockResolvedValue({ basket: {}, summary: {} })
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket/promo', headers: userHdr })
    expect(res.statusCode).toBe(200)
  })
})

describe('promo CRUD staff-gated', () => {
  it('GET /v1/basket/promos como user → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/basket/promos', headers: userHdr })
    expect(res.statusCode).toBe(403)
    expect(promosService.listPromos).not.toHaveBeenCalled()
  })

  it('GET /v1/basket/promos como staff → 200', async () => {
    promosService.listPromos.mockResolvedValue([{ code: 'A' }])
    const res = await app.inject({ method: 'GET', url: '/v1/basket/promos', headers: staffHdr })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ code: 'A' }])
  })

  it('GET /v1/basket/promos como admin (tenant admin) → 200', async () => {
    promosService.listPromos.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/basket/promos', headers: { Authorization: 'Bearer admin-token' } })
    expect(res.statusCode).toBe(200)
  })

  it('PUT /v1/basket/promos/:code como user → 403', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/promos/SAVE10', headers: { ...userHdr, 'Content-Type': 'application/json' },
      payload: { type: 'percent', value: 1000 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PUT /v1/basket/promos/:code como staff → upsert', async () => {
    promosService.upsertPromo.mockResolvedValue({ code: 'SAVE10' })
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/promos/SAVE10', headers: { ...staffHdr, 'Content-Type': 'application/json' },
      payload: { type: 'percent', value: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(promosService.upsertPromo).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAVE10' }))
  })

  it('DELETE /v1/basket/promos/:code como user → 403', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket/promos/SAVE10', headers: userHdr })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE /v1/basket/promos/:code como staff → 204', async () => {
    promosService.deletePromo.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket/promos/SAVE10', headers: staffHdr })
    expect(res.statusCode).toBe(204)
    expect(promosService.deletePromo).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAVE10' }))
  })
})

// La rama `req.query ?? {}` del handler de summary es inalcanzable por HTTP
// (fastify siempre provee req.query). Se invoca el handler directamente con
// req.query undefined para cubrir el lado falsy del `??`.
describe('defaults defensivos (?? {}) — handler directo', () => {
  async function captureHandlers() {
    const routes = []
    const rec = (m) => (p, o, h) => routes.push({ m, p, h: h ?? o })
    await basketRoutes({
      get: rec('get'), put: rec('put'), post: rec('post'), delete: rec('delete'), patch: rec('patch'),
      addHook: () => {},
    })
    return routes
  }

  it('GET /v1/basket/summary con req.query undefined → summaryQuery.parse({})', async () => {
    promosService.basketSummary.mockResolvedValue({ basket: {}, summary: {} })
    const routes = await captureHandlers()
    const summary = routes.find((r) => r.m === 'get' && r.p === '/v1/basket/summary')
    const identity = { appId: 'aikikan', tenantId: 't1', userId: 'u1' }
    await summary.h({ identity })
    expect(promosService.basketSummary).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1', userId: 'u1' }),
    )
  })
})
