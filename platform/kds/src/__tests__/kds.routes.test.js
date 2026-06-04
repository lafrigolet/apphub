// kds.routes — wiring HTTP → service.
// Valida status codes, delegación con ctxFromRequest(identity), parseo de query
// en listTickets y la validación zod del PATCH de status.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/kds.service.js', () => ({
  createStation:     vi.fn(),
  listStations:      vi.fn(),
  updateStation:     vi.fn(),
  deleteStation:     vi.fn(),
  listTickets:       vi.fn(),
  getTicket:         vi.fn(),
  bumpTicket:        vi.fn(),
  advanceTicket:     vi.fn(),
  bumpItem:          vi.fn(),
  listTicketsByOrder: vi.fn(),
  bumpOrderTickets:  vi.fn(),
  allDay:            vi.fn(),
  metrics:           vi.fn(),
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
        req.identity = { userId: 'u1', appId: 'resto', tenantId: 't1', subTenantId: null, role: 'kitchen' }
      })
    }),
  }
})

import { kdsRoutes } from '../routes/kds.routes.js'
import * as service from '../services/kds.service.js'

const TICKET = '11111111-1111-1111-1111-111111111111'

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
  await app.register(kdsRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_ERR_VALIDATION' || err.name === 'ZodError') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const auth = { authorization: 'Bearer staff-token', 'Content-Type': 'application/json' }
// For bodyless POST/DELETE — sending a JSON content-type with no body makes
// Fastify's parser 400; touch-screen clients hit these without that header.
const authNoBody = { authorization: 'Bearer staff-token' }
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('auth gate', () => {
  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/kds/stations' })
    expect(res.statusCode).toBe(401)
    expect(service.listStations).not.toHaveBeenCalled()
  })
})

describe('stations', () => {
  it('POST /stations → 201 + delega con identity', async () => {
    service.createStation.mockResolvedValue({ id: 'st1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/kds/stations', headers: auth,
      payload: { name: 'Caliente', routesCourses: ['main'] },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createStation).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'resto', tenantId: 't1', role: 'kitchen' }),
      expect.objectContaining({ name: 'Caliente', routesCourses: ['main'] }),
    )
  })

  it('POST /stations body inválido (name vacío) no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/kds/stations', headers: auth,
      payload: { name: '' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createStation).not.toHaveBeenCalled()
  })

  it('GET /stations delega', async () => {
    service.listStations.mockResolvedValue([{ id: 'st1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/kds/stations', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: 'st1' }])
    expect(service.listStations).toHaveBeenCalledWith(expect.objectContaining({ appId: 'resto' }))
  })
})

describe('tickets', () => {
  it('GET /tickets pasa filtros stationId/status/limit de la query', async () => {
    service.listTickets.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/kds/tickets?stationId=st1&status=fired&limit=20', headers: auth })
    expect(service.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      { stationId: 'st1', status: 'fired', limit: 20 },
    )
  })

  it('GET /tickets sin query → limit undefined', async () => {
    service.listTickets.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/kds/tickets', headers: auth })
    expect(service.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      { stationId: undefined, status: undefined, limit: undefined },
    )
  })

  it('GET /tickets/:id delega', async () => {
    service.getTicket.mockResolvedValue({ id: TICKET, items: [] })
    const res = await app.inject({ method: 'GET', url: `/v1/kds/tickets/${TICKET}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getTicket).toHaveBeenCalledWith(expect.anything(), TICKET)
  })

  it('PATCH /tickets/:id/status delega status validado', async () => {
    service.bumpTicket.mockResolvedValue({ id: TICKET, status: 'ready' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/tickets/${TICKET}/status`, headers: auth,
      payload: { status: 'ready' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.bumpTicket).toHaveBeenCalledWith(expect.anything(), TICKET, 'ready', null)
  })

  it('PATCH status inválido (no en enum) no llega al service', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/tickets/${TICKET}/status`, headers: auth,
      payload: { status: 'bogus' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.bumpTicket).not.toHaveBeenCalled()
  })
})

const STATION = '22222222-2222-2222-2222-222222222222'
const ORDER   = '33333333-3333-3333-3333-333333333333'
const ITEM    = '44444444-4444-4444-4444-444444444444'

describe('station patch/delete', () => {
  it('PATCH /stations/:id delega patch', async () => {
    service.updateStation.mockResolvedValue({ id: STATION, name: 'Fría' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/stations/${STATION}`, headers: auth,
      payload: { name: 'Fría', isActive: false },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateStation).toHaveBeenCalledWith(
      expect.anything(), STATION, expect.objectContaining({ name: 'Fría', isActive: false }),
    )
  })

  it('PATCH /stations/:id con body vacío → 422', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/stations/${STATION}`, headers: auth, payload: {},
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.updateStation).not.toHaveBeenCalled()
  })

  it('DELETE /stations/:id sin body → reassignTo null', async () => {
    service.deleteStation.mockResolvedValue({ deleted: true, reassignedTicketIds: [] })
    const res = await app.inject({ method: 'DELETE', url: `/v1/kds/stations/${STATION}`, headers: authNoBody })
    expect(res.statusCode).toBe(200)
    expect(service.deleteStation).toHaveBeenCalledWith(expect.anything(), STATION, { reassignTo: null })
  })

  it('DELETE /stations/:id con reassignTo lo pasa', async () => {
    service.deleteStation.mockResolvedValue({ deleted: true, reassignedTicketIds: ['t1'] })
    const res = await app.inject({
      method: 'DELETE', url: `/v1/kds/stations/${STATION}`, headers: auth,
      payload: { reassignTo: ORDER },
    })
    expect(res.statusCode).toBe(200)
    expect(service.deleteStation).toHaveBeenCalledWith(expect.anything(), STATION, { reassignTo: ORDER })
  })
})

describe('one-touch + item bump', () => {
  it('POST /tickets/:id/bump sin body delega advanceTicket', async () => {
    service.advanceTicket.mockResolvedValue({ id: TICKET, status: 'in_progress' })
    const res = await app.inject({ method: 'POST', url: `/v1/kds/tickets/${TICKET}/bump`, headers: authNoBody })
    expect(res.statusCode).toBe(200)
    expect(service.advanceTicket).toHaveBeenCalledWith(expect.anything(), TICKET)
  })

  it('PATCH /items/:itemId/status delega bumpItem', async () => {
    service.bumpItem.mockResolvedValue({ id: ITEM, status: 'ready' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/items/${ITEM}/status`, headers: auth, payload: { status: 'ready' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.bumpItem).toHaveBeenCalledWith(expect.anything(), ITEM, 'ready')
  })

  it('PATCH /items/:itemId/status con status fuera de enum → 422', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/items/${ITEM}/status`, headers: auth, payload: { status: 'picked_up' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.bumpItem).not.toHaveBeenCalled()
  })
})

describe('order grouping + mass bump', () => {
  it('GET /orders/:orderId/tickets delega', async () => {
    service.listTicketsByOrder.mockResolvedValue({ orderId: ORDER, aggregateStatus: 'fired', tickets: [] })
    const res = await app.inject({ method: 'GET', url: `/v1/kds/orders/${ORDER}/tickets`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.listTicketsByOrder).toHaveBeenCalledWith(expect.anything(), ORDER)
  })

  it('PATCH /orders/:orderId/bump delega status + reason', async () => {
    service.bumpOrderTickets.mockResolvedValue({ orderId: ORDER, bumped: 2, tickets: [] })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/kds/orders/${ORDER}/bump`, headers: auth,
      payload: { status: 'ready' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.bumpOrderTickets).toHaveBeenCalledWith(expect.anything(), ORDER, 'ready', null)
  })
})

describe('aggregates', () => {
  it('GET /allday pasa stationId', async () => {
    service.allDay.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/kds/allday?stationId=${STATION}`, headers: auth })
    expect(service.allDay).toHaveBeenCalledWith(expect.anything(), { stationId: STATION })
  })

  it('GET /metrics pasa from/to', async () => {
    service.metrics.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/kds/metrics?from=2026-01-01&to=2026-02-01', headers: auth })
    expect(service.metrics).toHaveBeenCalledWith(expect.anything(), { from: '2026-01-01', to: '2026-02-01' })
  })
})
