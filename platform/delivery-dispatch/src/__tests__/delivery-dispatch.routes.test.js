// delivery-dispatch.routes — delegación al service con ctx derivado de
// req.identity, validación zod y códigos de estado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/delivery-dispatch.service.js', () => ({
  createZone:        vi.fn(),
  listZones:         vi.fn(),
  createRider:       vi.fn(),
  listRiders:        vi.fn(),
  pingRiderLocation: vi.fn(),
  createDelivery:    vi.fn(),
  listDeliveries:    vi.fn(),
  getDelivery:       vi.fn(),
  assignRider:       vi.fn(),
  changeStatus:      vi.fn(),
}))

import { deliveryDispatchRoutes } from '../routes/delivery-dispatch.routes.js'
import * as service from '../services/delivery-dispatch.service.js'

const DEL_ID   = '11111111-1111-1111-1111-111111111111'
const RIDER_ID = '22222222-2222-2222-2222-222222222222'
const ORDER_ID = '33333333-3333-3333-3333-333333333333'

const identity = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'dispatcher' }

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
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = identity })
  await app.register(deliveryDispatchRoutes)
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

describe('zones', () => {
  it('POST 201 crea zona', async () => {
    service.createZone.mockResolvedValue({ id: 'z1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/zones',
      payload: { name: 'Centro', polygon: { type: 'Polygon' }, baseFeeCents: 100 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createZone).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1' }),
      expect.objectContaining({ name: 'Centro' }),
    )
  })

  it('POST rechaza name vacío', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/zones',
      payload: { name: '', polygon: {} },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createZone).not.toHaveBeenCalled()
  })

  it('GET lista zonas', async () => {
    service.listZones.mockResolvedValue([{ id: 'z1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/delivery-dispatch/zones' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: 'z1' }])
  })
})

describe('riders', () => {
  it('POST 201 crea rider', async () => {
    service.createRider.mockResolvedValue({ id: RIDER_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/riders',
      payload: { displayName: 'Ana', vehicle: 'bike' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createRider).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ displayName: 'Ana' }))
  })

  it('GET lista riders filtrando por status', async () => {
    service.listRiders.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/delivery-dispatch/riders?status=available' })
    expect(res.statusCode).toBe(200)
    expect(service.listRiders).toHaveBeenCalledWith(expect.anything(), { status: 'available' })
  })

  it('POST ping actualiza ubicación', async () => {
    service.pingRiderLocation.mockResolvedValue({ id: RIDER_ID })
    const res = await app.inject({
      method: 'POST', url: `/v1/delivery-dispatch/riders/${RIDER_ID}/ping`,
      payload: { lat: 1.1, lng: 2.2, status: 'en_route' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.pingRiderLocation).toHaveBeenCalledWith(expect.anything(), RIDER_ID, expect.objectContaining({ lat: 1.1, lng: 2.2 }))
  })

  it('POST ping rechaza lat no numérico', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/delivery-dispatch/riders/${RIDER_ID}/ping`,
      payload: { lat: 'nope', lng: 2 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})

describe('deliveries', () => {
  it('POST 201 crea entrega', async () => {
    service.createDelivery.mockResolvedValue({ id: DEL_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/deliveries',
      payload: { orderId: ORDER_ID, dropAddress: { line1: 'C/ Mayor' } },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: ORDER_ID }))
  })

  it('POST rechaza orderId no uuid', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/deliveries',
      payload: { orderId: 'nope', dropAddress: { line1: 'x' } },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })

  it('GET lista con filtros y limit numérico', async () => {
    service.listDeliveries.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/delivery-dispatch/deliveries?status=pending&riderId=r1&limit=5' })
    expect(res.statusCode).toBe(200)
    expect(service.listDeliveries).toHaveBeenCalledWith(expect.anything(), { status: 'pending', riderId: 'r1', limit: 5 })
  })

  it('GET lista sin limit → undefined', async () => {
    service.listDeliveries.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/delivery-dispatch/deliveries' })
    expect(service.listDeliveries).toHaveBeenCalledWith(expect.anything(), { status: undefined, riderId: undefined, limit: undefined })
  })

  it('GET :id devuelve entrega', async () => {
    service.getDelivery.mockResolvedValue({ id: DEL_ID, events: [] })
    const res = await app.inject({ method: 'GET', url: `/v1/delivery-dispatch/deliveries/${DEL_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getDelivery).toHaveBeenCalledWith(expect.anything(), DEL_ID)
  })

  it('POST :id/assign asigna rider', async () => {
    service.assignRider.mockResolvedValue({ id: DEL_ID })
    const res = await app.inject({
      method: 'POST', url: `/v1/delivery-dispatch/deliveries/${DEL_ID}/assign`,
      payload: { riderId: RIDER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(service.assignRider).toHaveBeenCalledWith(expect.anything(), DEL_ID, RIDER_ID)
  })

  it('PATCH :id/status cambia estado pasando meta sin status', async () => {
    service.changeStatus.mockResolvedValue({ id: DEL_ID, status: 'delivered' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/delivery-dispatch/deliveries/${DEL_ID}/status`,
      payload: { status: 'delivered', lat: 1, lng: 2 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeStatus).toHaveBeenCalledWith(expect.anything(), DEL_ID, 'delivered', expect.objectContaining({ lat: 1, lng: 2 }))
  })

  it('PATCH :id/status propaga ConflictError (409)', async () => {
    const err = new Error('cannot transition'); err.statusCode = 409; err.code = 'CONFLICT'
    service.changeStatus.mockRejectedValue(err)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/delivery-dispatch/deliveries/${DEL_ID}/status`,
      payload: { status: 'delivered' },
    })
    expect(res.statusCode).toBe(409)
  })
})
