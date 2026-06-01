// kds.routes — wiring HTTP → service.
// Valida status codes, delegación con ctxFromRequest(identity), parseo de query
// en listTickets y la validación zod del PATCH de status.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/kds.service.js', () => ({
  createStation: vi.fn(),
  listStations:  vi.fn(),
  listTickets:   vi.fn(),
  getTicket:     vi.fn(),
  bumpTicket:    vi.fn(),
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
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(kdsRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const auth = { authorization: 'Bearer staff-token', 'Content-Type': 'application/json' }
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
    expect(service.bumpTicket).toHaveBeenCalledWith(expect.anything(), TICKET, 'ready')
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
