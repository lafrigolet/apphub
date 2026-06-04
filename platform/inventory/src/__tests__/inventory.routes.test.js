// inventory.routes — wiring HTTP → service.
// Valida status codes, delegación con ctxFromRequest(identity), parseo de
// query (limit/offset), el 404 de getItem y la validación zod del body.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/inventory.service.js', () => ({
  listItems:    vi.fn(),
  getItem:      vi.fn(),
  upsertItem:   vi.fn(),
  reserveItem:  vi.fn(),
  releaseItem:  vi.fn(),
  commitItem:   vi.fn(),
  restockItem:  vi.fn(),
  listMovements: vi.fn(),
  listVariants: vi.fn(),
  addVariant:   vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        req.identity = { userId: 'u1', appId: 'shop', tenantId: 't1', subTenantId: null, role: 'admin' }
      })
    }),
  }
})

import { inventoryRoutes } from '../routes/inventory.routes.js'
import * as service from '../services/inventory.service.js'

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
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(inventoryRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const auth = { authorization: 'Bearer admin-token', 'Content-Type': 'application/json' }
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('auth gate', () => {
  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inventory' })
    expect(res.statusCode).toBe(401)
    expect(service.listItems).not.toHaveBeenCalled()
  })
})

describe('GET /v1/inventory', () => {
  it('sin query → limit/offset undefined', async () => {
    service.listItems.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/inventory', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'shop', tenantId: 't1' }),
      { limit: undefined, offset: undefined },
    )
  })

  it('parsea limit/offset de la query', async () => {
    service.listItems.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/inventory?limit=10&offset=5', headers: auth })
    expect(service.listItems).toHaveBeenCalledWith(expect.anything(), { limit: 10, offset: 5 })
  })
})

describe('GET /v1/inventory/:sku', () => {
  it('200 cuando existe', async () => {
    service.getItem.mockResolvedValue({ sku: 'SKU1' })
    const res = await app.inject({ method: 'GET', url: '/v1/inventory/SKU1', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().sku).toBe('SKU1')
    expect(service.getItem).toHaveBeenCalledWith(expect.anything(), 'SKU1')
  })

  it('404 cuando no existe', async () => {
    service.getItem.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/v1/inventory/NOPE', headers: auth })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

describe('PUT /v1/inventory/:sku', () => {
  it('upsert delega body + sku del path', async () => {
    service.upsertItem.mockResolvedValue({ sku: 'SKU1', qty_on_hand: 5 })
    const res = await app.inject({
      method: 'PUT', url: '/v1/inventory/SKU1', headers: auth,
      payload: { qtyOnHand: 5, lowStockThreshold: 2 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.upsertItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sku: 'SKU1', qtyOnHand: 5, lowStockThreshold: 2 }),
    )
  })

  it('body inválido (qtyOnHand negativo) no llega al service', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/inventory/SKU1', headers: auth,
      payload: { qtyOnHand: -1 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.upsertItem).not.toHaveBeenCalled()
  })
})

describe('reserve / release / commit', () => {
  it('POST /:sku/reserve delega', async () => {
    service.reserveItem.mockResolvedValue({ sku: 'SKU1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/SKU1/reserve', headers: auth,
      payload: { qty: 2, refType: 'order' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.reserveItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sku: 'SKU1', qty: 2 }))
  })

  it('POST /:sku/release delega', async () => {
    service.releaseItem.mockResolvedValue({ sku: 'SKU1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/SKU1/release', headers: auth,
      payload: { qty: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.releaseItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sku: 'SKU1', qty: 1 }))
  })

  it('POST /:sku/commit delega', async () => {
    service.commitItem.mockResolvedValue({ sku: 'SKU1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/SKU1/commit', headers: auth,
      payload: { qty: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.commitItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sku: 'SKU1', qty: 1 }))
  })

  it('reserve body inválido (qty 0) no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/SKU1/reserve', headers: auth,
      payload: { qty: 0 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.reserveItem).not.toHaveBeenCalled()
  })
})

describe('GET /v1/inventory filtros', () => {
  it('parsea lowStock/rootOnly/search', async () => {
    service.listItems.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/inventory?lowStock=true&rootOnly=true&search=shoe', headers: auth })
    expect(service.listItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lowStock: true, rootOnly: true, search: 'shoe' }),
    )
  })
})

describe('POST /v1/inventory/:sku/restock', () => {
  it('delega body + sku', async () => {
    service.restockItem.mockResolvedValue({ sku: 'SKU1', qty_on_hand: 7 })
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/SKU1/restock', headers: auth,
      payload: { qty: 2, reason: 'return' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.restockItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sku: 'SKU1', qty: 2, reason: 'return' }),
    )
  })

  it('reason inválido no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/SKU1/restock', headers: auth,
      payload: { qty: 2, reason: 'bogus' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.restockItem).not.toHaveBeenCalled()
  })
})

describe('GET /v1/inventory/:sku/movements', () => {
  it('delega sku + filtros parseados', async () => {
    service.listMovements.mockResolvedValue([{ id: 'm1' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/inventory/SKU1/movements?reason=commit&limit=10', headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(service.listMovements).toHaveBeenCalledWith(
      expect.anything(), 'SKU1',
      expect.objectContaining({ reason: 'commit', limit: 10 }),
    )
  })

  it('reason inválido no llega al service', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/inventory/SKU1/movements?reason=bogus', headers: auth,
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.listMovements).not.toHaveBeenCalled()
  })
})

describe('variants', () => {
  it('GET /:sku/variants delega', async () => {
    service.listVariants.mockResolvedValue({ parent: { sku: 'P' }, variants: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/inventory/P/variants', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.listVariants).toHaveBeenCalledWith(expect.anything(), 'P')
  })

  it('POST /:sku/variants → 201 + delega body', async () => {
    service.addVariant.mockResolvedValue({ sku: 'P-M' })
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/P/variants', headers: auth,
      payload: { sku: 'P-M', optionValues: { size: 'M' } },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addVariant).toHaveBeenCalledWith(
      expect.anything(), 'P',
      expect.objectContaining({ sku: 'P-M', optionValues: { size: 'M' } }),
    )
  })

  it('POST /:sku/variants body inválido no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inventory/P/variants', headers: auth,
      payload: { sku: '' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.addVariant).not.toHaveBeenCalled()
  })
})
