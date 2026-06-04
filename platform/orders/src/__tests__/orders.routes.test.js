// orders.routes — wiring HTTP → service. Verifica status codes (201 create),
// delegación con ctx de req.identity, parsing de params/query (buyerUserId,
// status, limit/offset) y validación zod de bodies (FSM status enum, etc).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/orders.service.js', () => ({
  createOrder:           vi.fn(),
  listOrders:            vi.fn(),
  getOrder:              vi.fn(),
  changeStatus:          vi.fn(),
  cancelOrder:           vi.fn(),
  refundOrder:           vi.fn(),
  listModifications:     vi.fn(),
  changeShippingAddress: vi.fn(),
  addOrderNote:          vi.fn(),
  addItem:               vi.fn(),
  changeItemQty:         vi.fn(),
  removeItem:            vi.fn(),
  exportOrdersCsv:       vi.fn(),
}))

import { ordersRoutes } from '../routes/orders.routes.js'
import * as service from '../services/orders.service.js'

const IDENTITY = { appId: 'mk', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'buyer' }

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = IDENTITY })
  await app.register(ordersRoutes)
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

const OID = '11111111-1111-1111-1111-111111111111'
const item = { sku: 'A', productName: 'Apple', qty: 1, unitPriceCents: 100 }

describe('POST /v1/orders', () => {
  it('201 + delega createOrder con ctx', async () => {
    service.createOrder.mockResolvedValue({ id: OID })
    const res = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { 'Content-Type': 'application/json' },
      payload: { currency: 'EUR', items: [item] },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'mk', tenantId: 't1', userId: 'u1' }),
      expect.objectContaining({ currency: 'EUR', items: [expect.objectContaining({ sku: 'A' })] }),
    )
  })

  it('sin items → rechazado por zod', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { 'Content-Type': 'application/json' },
      payload: { currency: 'EUR', items: [] },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createOrder).not.toHaveBeenCalled()
  })
})

describe('GET /v1/orders', () => {
  it('parsea buyerUserId/status/limit/offset de query', async () => {
    service.listOrders.mockResolvedValue([{ id: OID }])
    const res = await app.inject({ method: 'GET', url: '/v1/orders?buyerUserId=b1&status=paid&limit=5&offset=10' })
    expect(res.statusCode).toBe(200)
    expect(service.listOrders).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ buyerUserId: 'b1', status: 'paid', limit: 5, offset: 10 }),
    )
  })

  it('sin query → filtros undefined', async () => {
    service.listOrders.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/orders' })
    expect(service.listOrders).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ buyerUserId: undefined, status: undefined, limit: undefined, offset: undefined }),
    )
  })

  it('parsea filtros de rango de fecha/importe/vendor', async () => {
    service.listOrders.mockResolvedValue([])
    const url = '/v1/orders?createdAfter=2026-01-01T00:00:00.000Z&createdBefore=2026-02-01T00:00:00.000Z'
      + '&totalMinCents=100&totalMaxCents=5000&vendorTenantId=33333333-3333-3333-3333-333333333333'
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(service.listOrders).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      createdAfter: '2026-01-01T00:00:00.000Z',
      createdBefore: '2026-02-01T00:00:00.000Z',
      totalMinCents: 100, totalMaxCents: 5000,
      vendorTenantId: '33333333-3333-3333-3333-333333333333',
    }))
  })
})

describe('GET /v1/orders/export.csv', () => {
  it('devuelve CSV con content-type y disposition', async () => {
    service.exportOrdersCsv.mockResolvedValue('id,status\no1,paid')
    const res = await app.inject({ method: 'GET', url: '/v1/orders/export.csv?status=paid' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    expect(res.body).toBe('id,status\no1,paid')
    expect(service.exportOrdersCsv).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ status: 'paid' }),
    )
  })
})

describe('item editing routes', () => {
  it('POST /v1/orders/:id/items → 201 + addItem', async () => {
    service.addItem.mockResolvedValue({ order: { id: OID }, item: { id: 'it1' } })
    const res = await app.inject({
      method: 'POST', url: `/v1/orders/${OID}/items`,
      headers: { 'Content-Type': 'application/json' },
      payload: { sku: 'B', productName: 'Banana', qty: 2, unitPriceCents: 50, reason: 'add' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addItem).toHaveBeenCalledWith(
      expect.anything(), OID,
      expect.objectContaining({ sku: 'B', qty: 2, unitPriceCents: 50 }), 'add',
    )
    // reason no debe filtrarse al item
    expect(service.addItem.mock.calls[0][2]).not.toHaveProperty('reason')
  })

  it('PATCH /v1/orders/:id/items/:itemId → changeItemQty', async () => {
    service.changeItemQty.mockResolvedValue({ order: { id: OID } })
    const ITEM = '44444444-4444-4444-4444-444444444444'
    const res = await app.inject({
      method: 'PATCH', url: `/v1/orders/${OID}/items/${ITEM}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { qty: 3, reason: 'more' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeItemQty).toHaveBeenCalledWith(expect.anything(), OID, ITEM, 3, 'more')
  })

  it('DELETE /v1/orders/:id/items/:itemId → removeItem', async () => {
    service.removeItem.mockResolvedValue({ order: { id: OID } })
    const ITEM = '44444444-4444-4444-4444-444444444444'
    const res = await app.inject({
      method: 'DELETE', url: `/v1/orders/${OID}/items/${ITEM}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { reason: 'oops' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.removeItem).toHaveBeenCalledWith(expect.anything(), OID, ITEM, 'oops')
  })

  it('qty inválido (0) → rechazado por zod', async () => {
    const ITEM = '44444444-4444-4444-4444-444444444444'
    const res = await app.inject({
      method: 'PATCH', url: `/v1/orders/${OID}/items/${ITEM}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { qty: 0 },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.changeItemQty).not.toHaveBeenCalled()
  })
})

describe('GET /v1/orders/:id', () => {
  it('delega getOrder con el id', async () => {
    service.getOrder.mockResolvedValue({ id: OID })
    const res = await app.inject({ method: 'GET', url: `/v1/orders/${OID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getOrder).toHaveBeenCalledWith(expect.anything(), OID)
  })
})

describe('PATCH /v1/orders/:id/status', () => {
  it('delega changeStatus con status + reason', async () => {
    service.changeStatus.mockResolvedValue({ id: OID, status: 'paid' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/orders/${OID}/status`,
      headers: { 'Content-Type': 'application/json' },
      payload: { status: 'paid', reason: 'ok' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeStatus).toHaveBeenCalledWith(expect.anything(), OID, 'paid', 'ok')
  })

  it('status fuera del enum → rechazado', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/orders/${OID}/status`,
      headers: { 'Content-Type': 'application/json' },
      payload: { status: 'NOPE' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.changeStatus).not.toHaveBeenCalled()
  })
})

describe('POST /v1/orders/:id/cancel', () => {
  it('delega cancelOrder con reason', async () => {
    service.cancelOrder.mockResolvedValue({ id: OID, status: 'cancelled' })
    const res = await app.inject({
      method: 'POST', url: `/v1/orders/${OID}/cancel`,
      headers: { 'Content-Type': 'application/json' },
      payload: { reason: 'changed mind' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.cancelOrder).toHaveBeenCalledWith(expect.anything(), OID, 'changed mind')
  })
})

describe('POST /v1/orders/:id/refund', () => {
  it('delega refundOrder con reason', async () => {
    service.refundOrder.mockResolvedValue({ id: OID, status: 'refunded' })
    const res = await app.inject({
      method: 'POST', url: `/v1/orders/${OID}/refund`,
      headers: { 'Content-Type': 'application/json' },
      payload: { reason: 'broken' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.refundOrder).toHaveBeenCalledWith(expect.anything(), OID, 'broken')
  })
})

describe('GET /v1/orders/:id/modifications', () => {
  it('lista modificaciones envueltas en {data}', async () => {
    service.listModifications.mockResolvedValue([{ id: 'mod1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/orders/${OID}/modifications` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: 'mod1' }] })
    expect(service.listModifications).toHaveBeenCalledWith(expect.anything(), OID)
  })
})

describe('PUT /v1/orders/:id/shipping-address', () => {
  it('separa reason de la address y delega changeShippingAddress', async () => {
    service.changeShippingAddress.mockResolvedValue({ id: 'mod1' })
    const res = await app.inject({
      method: 'PUT', url: `/v1/orders/${OID}/shipping-address`,
      headers: { 'Content-Type': 'application/json' },
      payload: { line1: 'New St', city: 'X', reason: 'moved' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeShippingAddress).toHaveBeenCalledWith(
      expect.anything(), OID, expect.objectContaining({ line1: 'New St', city: 'X' }), 'moved',
    )
    // reason no debe filtrarse al objeto address
    const addrArg = service.changeShippingAddress.mock.calls[0][2]
    expect(addrArg).not.toHaveProperty('reason')
  })
})

describe('POST /v1/orders/:id/notes', () => {
  it('delega addOrderNote con la nota', async () => {
    service.addOrderNote.mockResolvedValue({ id: 'mod1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/orders/${OID}/notes`,
      headers: { 'Content-Type': 'application/json' },
      payload: { note: 'check stock' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.addOrderNote).toHaveBeenCalledWith(expect.anything(), OID, 'check stock')
  })

  it('nota vacía → rechazada', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/orders/${OID}/notes`,
      headers: { 'Content-Type': 'application/json' },
      payload: { note: '' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.addOrderNote).not.toHaveBeenCalled()
  })
})
