// shipping.routes — wiring HTTP → shipping/returns services. Mockea ambos
// servicios; la identity la inyecta un hook (en prod la pone appGuard).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/shipping.service.js', () => ({
  listZones:            vi.fn(),
  createZone:           vi.fn(),
  listRates:            vi.fn(),
  createRate:           vi.fn(),
  quote:                vi.fn(),
  createShipment:       vi.fn(),
  getShipment:          vi.fn(),
  appendEvent:          vi.fn(),
  listPackages:         vi.fn(),
  addPackage:           vi.fn(),
  ingestCarrierWebhook: vi.fn(),
}))
vi.mock('../services/returns.service.js', () => ({
  createReturn:      vi.fn(),
  listReturns:       vi.fn(),
  getReturn:         vi.fn(),
  approveReturn:     vi.fn(),
  rejectReturn:      vi.fn(),
  cancelReturn:      vi.fn(),
  issueReturnLabel:  vi.fn(),
  markShipped:       vi.fn(),
  receiveReturn:     vi.fn(),
  restockReturn:     vi.fn(),
  refundReturn:      vi.fn(),
}))

import { shippingRoutes, returnsRoutes } from '../routes/shipping.routes.js'
import * as service from '../services/shipping.service.js'
import * as returns from '../services/returns.service.js'

const APP = 'shop'
const TEN = '00000000-0000-0000-0000-000000000001'
const ORDER = '11111111-1111-1111-1111-111111111111'
const SHIP = '22222222-2222-2222-2222-222222222222'
const RET = '33333333-3333-3333-3333-333333333333'
const ITEM = '44444444-4444-4444-4444-444444444444'

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
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => {
    if (req.routeOptions?.config?.public) return
    req.identity = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'staff' }
  })
  await app.register(shippingRoutes)
  await app.register(returnsRoutes)
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

const auth = { Authorization: 'Bearer t', 'Content-Type': 'application/json' }
const noBody = { Authorization: 'Bearer t' }

describe('zones / rates / quote', () => {
  it('GET zones', async () => {
    service.listZones.mockResolvedValue([])
    expect((await app.inject({ method: 'GET', url: '/v1/shipping/zones', headers: noBody })).statusCode).toBe(200)
  })
  it('POST zone → 201', async () => {
    service.createZone.mockResolvedValue({ id: 'z1' })
    const res = await app.inject({ method: 'POST', url: '/v1/shipping/zones', headers: auth, payload: { name: 'EU', countryCodes: ['ES'] } })
    expect(res.statusCode).toBe(201)
  })
  it('GET rates con zoneId', async () => {
    service.listRates.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/shipping/rates?zoneId=z1', headers: noBody })
    expect(service.listRates).toHaveBeenCalledWith(expect.anything(), 'z1')
  })
  it('POST rate → 201', async () => {
    service.createRate.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({ method: 'POST', url: '/v1/shipping/rates', headers: auth, payload: { name: 'std', priceCents: 500 } })
    expect(res.statusCode).toBe(201)
  })
  it('GET quote con country', async () => {
    service.quote.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/shipping/quote?country=ES', headers: noBody })
    expect(service.quote).toHaveBeenCalledWith(expect.anything(), { country: 'ES' })
  })
})

describe('shipments', () => {
  it('POST shipment → 201', async () => {
    service.createShipment.mockResolvedValue({ id: SHIP })
    const res = await app.inject({ method: 'POST', url: '/v1/shipping/shipments', headers: auth, payload: { orderId: ORDER } })
    expect(res.statusCode).toBe(201)
  })
  it('GET shipment by id', async () => {
    service.getShipment.mockResolvedValue({ id: SHIP, events: [] })
    expect((await app.inject({ method: 'GET', url: `/v1/shipping/shipments/${SHIP}`, headers: noBody })).statusCode).toBe(200)
  })
  it('POST event → 201', async () => {
    service.appendEvent.mockResolvedValue({ shipment: {}, event: {} })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/shipments/${SHIP}/events`, headers: auth, payload: { code: 'shipped' } })
    expect(res.statusCode).toBe(201)
  })
  it('GET packages → { data }', async () => {
    service.listPackages.mockResolvedValue([{ id: 'p1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/shipping/shipments/${SHIP}/packages`, headers: noBody })
    expect(res.json().data).toEqual([{ id: 'p1' }])
  })
  it('POST package → 201', async () => {
    service.addPackage.mockResolvedValue({ id: 'p1' })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/shipments/${SHIP}/packages`, headers: auth, payload: { weightGrams: 100 } })
    expect(res.statusCode).toBe(201)
  })
})

describe('carrier webhooks (público)', () => {
  it('payload string → 202', async () => {
    service.ingestCarrierWebhook.mockResolvedValue({ id: 'w1', signatureValid: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/shipping/webhooks/easypost',
      headers: { 'Content-Type': 'application/json', 'x-hmac-signature': 'sig' },
      payload: JSON.stringify({ id: 'ext1', tracking_code: 'TC' }),
    })
    expect(res.statusCode).toBe(202)
    const call = service.ingestCarrierWebhook.mock.calls[0]
    expect(call[0]).toBe('easypost')
    expect(call[1].signatureHeader).toBe('sig')
  })
  it('duplicado → 200 { duplicate }', async () => {
    service.ingestCarrierWebhook.mockResolvedValue({ duplicate: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/shipping/webhooks/ups',
      headers: { 'Content-Type': 'application/json' },
      payload: { id: 'ext1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().duplicate).toBe(true)
  })
  it('body string no-JSON → safeJson fallback {}', async () => {
    service.ingestCarrierWebhook.mockResolvedValue({ id: 'w2', signatureValid: null })
    const res = await app.inject({
      method: 'POST', url: '/v1/shipping/webhooks/dhl',
      headers: { 'Content-Type': 'text/plain', 'x-dhl-signature': 'd' },
      payload: 'not-json',
    })
    expect(res.statusCode).toBe(202)
    expect(service.ingestCarrierWebhook.mock.calls[0][1].payload).toEqual({})
  })
  it('carrier inválido → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/shipping/webhooks/usps',
      headers: { 'Content-Type': 'application/json' }, payload: {},
    })
    expect([400, 500]).toContain(res.statusCode)
  })
})

describe('returns', () => {
  it('POST return → 201', async () => {
    returns.createReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({
      method: 'POST', url: '/v1/shipping/returns', headers: auth,
      payload: { orderId: ORDER, items: [{ sku: 'A', qty: 1 }] },
    })
    expect(res.statusCode).toBe(201)
  })
  it('GET returns con filtros → { data }', async () => {
    returns.listReturns.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/shipping/returns?status=requested&orderId=o1&limit=5', headers: noBody })
    expect(returns.listReturns).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'requested', limit: 5 }))
  })
  it('GET returns sin limit → limit undefined', async () => {
    returns.listReturns.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/shipping/returns', headers: noBody })
    expect(returns.listReturns).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: undefined }))
  })
  it('GET return by id', async () => {
    returns.getReturn.mockResolvedValue({ id: RET })
    expect((await app.inject({ method: 'GET', url: `/v1/shipping/returns/${RET}`, headers: noBody })).statusCode).toBe(200)
  })
  it('POST approve', async () => {
    returns.approveReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/approve`, headers: auth, payload: { notes: 'ok' } })
    expect(res.statusCode).toBe(200)
    expect(returns.approveReturn).toHaveBeenCalledWith(expect.anything(), RET, 'ok')
  })
  it('POST reject (sin body) → notes undefined', async () => {
    returns.rejectReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/reject`, headers: auth, payload: {} })
    expect(res.statusCode).toBe(200)
  })
  it('POST cancel', async () => {
    returns.cancelReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/cancel`, headers: auth, payload: { reason: 'x' } })
    expect(res.statusCode).toBe(200)
  })
  it('POST issue-label', async () => {
    returns.issueReturnLabel.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/issue-label`, headers: auth, payload: { carrier: 'ups' } })
    expect(res.statusCode).toBe(200)
  })
  it('POST shipped', async () => {
    returns.markShipped.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/shipped`, headers: auth, payload: { trackingCode: 'TC' } })
    expect(res.statusCode).toBe(200)
  })
  it('POST receive', async () => {
    returns.receiveReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({
      method: 'POST', url: `/v1/shipping/returns/${RET}/receive`, headers: auth,
      payload: { items: [{ id: ITEM, qtyReceived: 1 }] },
    })
    expect(res.statusCode).toBe(200)
  })
  it('POST restock', async () => {
    returns.restockReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/restock`, headers: noBody })
    expect(res.statusCode).toBe(200)
  })
  it('POST refund', async () => {
    returns.refundReturn.mockResolvedValue({ id: RET })
    const res = await app.inject({ method: 'POST', url: `/v1/shipping/returns/${RET}/refund`, headers: auth, payload: { amountCents: 500 } })
    expect(res.statusCode).toBe(200)
  })
})

// Ramas `?? {}` / `req.body ?? {}`: fastify valida el schema-body antes del
// handler → inalcanzables vía inject. Capturamos los handlers con un fake
// fastify (recorder) y los invocamos con req.body undefined.
describe('defaults defensivos (?? {}) — handlers directos', () => {
  function recorder() {
    const routes = []
    return {
      routes,
      fastify: {
        addHook: () => {},
        get:    (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
        post:   (p, o, h) => routes.push({ m: 'post', p, h: h ?? o }),
        patch:  (p, o, h) => routes.push({ m: 'patch', p, h: h ?? o }),
      },
    }
  }
  const identity = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'staff' }
  const reply = () => ({ status: () => ({ send: (x) => x }) })

  async function shippingHandlers() {
    const { routes, fastify } = recorder()
    await shippingRoutes(fastify)
    return routes
  }
  async function returnsHandlers() {
    const { routes, fastify } = recorder()
    await returnsRoutes(fastify)
    return routes
  }

  it('webhook con req.body undefined → JSON.stringify(req.body ?? {})', async () => {
    service.ingestCarrierWebhook.mockResolvedValue({ id: 'w1', signatureValid: null })
    const routes = await shippingHandlers()
    const wh = routes.find((r) => r.m === 'post' && r.p === '/v1/shipping/webhooks/:carrier')
    await wh.h({ params: { carrier: 'ups' }, headers: {} }, reply())
    expect(service.ingestCarrierWebhook).toHaveBeenCalledWith(
      'ups',
      expect.objectContaining({ rawBody: '{}' }),
    )
  })

  it.each([
    ['/v1/shipping/returns/:id/approve',     'approveReturn'],
    ['/v1/shipping/returns/:id/reject',      'rejectReturn'],
    ['/v1/shipping/returns/:id/cancel',      'cancelReturn'],
    ['/v1/shipping/returns/:id/issue-label', 'issueReturnLabel'],
    ['/v1/shipping/returns/:id/shipped',     'markShipped'],
    ['/v1/shipping/returns/:id/receive',     'receiveReturn'],
  ])('%s con req.body undefined → body schema default {} → %s', async (path, fn) => {
    returns[fn].mockResolvedValue({ id: RET })
    const routes = await returnsHandlers()
    const route = routes.find((r) => r.m === 'post' && r.p === path)
    await route.h({ params: { id: RET }, identity })
    expect(returns[fn]).toHaveBeenCalled()
  })
})
