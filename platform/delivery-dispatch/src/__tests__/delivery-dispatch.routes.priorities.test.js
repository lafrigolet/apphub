// Routes for the new priority features: quote, zone/rider CRUD, carrier webhook.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/delivery-dispatch.service.js', () => ({
  createZone:          vi.fn(),
  listZones:           vi.fn(),
  updateZone:          vi.fn(),
  deleteZone:          vi.fn(),
  quote:               vi.fn(),
  createRider:         vi.fn(),
  listRiders:          vi.fn(),
  updateRider:         vi.fn(),
  deactivateRider:     vi.fn(),
  pingRiderLocation:   vi.fn(),
  createDelivery:      vi.fn(),
  listDeliveries:      vi.fn(),
  getDelivery:         vi.fn(),
  assignRider:         vi.fn(),
  changeStatus:        vi.fn(),
  handleCarrierWebhook: vi.fn(),
}))

import { deliveryDispatchRoutes } from '../routes/delivery-dispatch.routes.js'
import * as service from '../services/delivery-dispatch.service.js'

const ZONE_ID  = 'aaaaaaaa-0000-0000-0000-000000000001'
const RIDER_ID = '22222222-2222-2222-2222-222222222222'
const identity = { appId: 'resto', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'dispatcher' }

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

describe('quote', () => {
  it('GET quote coerces lat/lng and delegates', async () => {
    service.quote.mockResolvedValue({ deliverable: true, feeCents: 300 })
    const res = await app.inject({ method: 'GET', url: '/v1/delivery-dispatch/quote?lat=40.4&lng=-3.7&orderTotalCents=2000' })
    expect(res.statusCode).toBe(200)
    expect(service.quote).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'resto', tenantId: 't1' }),
      { lat: 40.4, lng: -3.7, orderTotalCents: 2000 },
    )
  })
  it('GET quote rejects non-numeric lat', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/delivery-dispatch/quote?lat=abc&lng=-3.7' })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})

describe('zone CRUD', () => {
  it('PATCH updates a zone', async () => {
    service.updateZone.mockResolvedValue({ id: ZONE_ID, name: 'Nuevo' })
    const res = await app.inject({ method: 'PATCH', url: `/v1/delivery-dispatch/zones/${ZONE_ID}`, payload: { name: 'Nuevo' } })
    expect(res.statusCode).toBe(200)
    expect(service.updateZone).toHaveBeenCalledWith(expect.anything(), ZONE_ID, { name: 'Nuevo' })
  })
  it('DELETE removes a zone', async () => {
    service.deleteZone.mockResolvedValue({ id: ZONE_ID, deleted: true })
    const res = await app.inject({ method: 'DELETE', url: `/v1/delivery-dispatch/zones/${ZONE_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.deleteZone).toHaveBeenCalledWith(expect.anything(), ZONE_ID)
  })
})

describe('rider CRUD', () => {
  it('PATCH updates a rider', async () => {
    service.updateRider.mockResolvedValue({ id: RIDER_ID, phone: '600' })
    const res = await app.inject({ method: 'PATCH', url: `/v1/delivery-dispatch/riders/${RIDER_ID}`, payload: { phone: '600' } })
    expect(res.statusCode).toBe(200)
    expect(service.updateRider).toHaveBeenCalledWith(expect.anything(), RIDER_ID, { phone: '600' })
  })
  it('DELETE deactivates a rider with reason', async () => {
    service.deactivateRider.mockResolvedValue({ id: RIDER_ID, deleted_reason: 'baja' })
    const res = await app.inject({ method: 'DELETE', url: `/v1/delivery-dispatch/riders/${RIDER_ID}`, payload: { reason: 'baja' } })
    expect(res.statusCode).toBe(200)
    expect(service.deactivateRider).toHaveBeenCalledWith(expect.anything(), RIDER_ID, 'baja')
  })
  it('DELETE works without a body', async () => {
    service.deactivateRider.mockResolvedValue({ id: RIDER_ID })
    const res = await app.inject({ method: 'DELETE', url: `/v1/delivery-dispatch/riders/${RIDER_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.deactivateRider).toHaveBeenCalledWith(expect.anything(), RIDER_ID, undefined)
  })
})

describe('carrier webhook', () => {
  it('POST webhook returns 200 when matched', async () => {
    service.handleCarrierWebhook.mockResolvedValue({ matched: true, transitioned: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/webhooks/uber',
      headers: { 'x-webhook-signature': 'abc' },
      payload: { appId: 'resto', tenantId: 't1', externalRef: 'EXT-1', status: 'delivered' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.handleCarrierWebhook).toHaveBeenCalledWith('uber', expect.objectContaining({
      signature: 'abc',
      body: expect.objectContaining({ externalRef: 'EXT-1' }),
    }))
  })
  it('POST webhook returns 202 when not matched', async () => {
    service.handleCarrierWebhook.mockResolvedValue({ matched: false })
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/webhooks/glovo',
      headers: { 'x-webhook-signature': 'abc' },
      payload: { appId: 'resto', tenantId: 't1', externalRef: 'EXT-2', status: 'DELIVERED' },
    })
    expect(res.statusCode).toBe(202)
  })
  it('POST webhook rejects unknown provider param', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/delivery-dispatch/webhooks/fedex',
      payload: { appId: 'resto', tenantId: 't1', externalRef: 'EXT-3' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})
