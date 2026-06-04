// reservations.routes — HTTP surface. Asserts delegation to the service with
// ctx derived from req.identity, status codes, query forwarding, and zod
// validation rejection. Service is fully mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/reservations.service.js', () => ({
  createReservation:  vi.fn(),
  listReservations:   vi.fn(),
  getReservation:     vi.fn(),
  changeStatus:       vi.fn(),
  addToWaitlist:      vi.fn(),
  listWaitlist:       vi.fn(),
  notifyWaitlist:     vi.fn(),
  createServiceHours: vi.fn(),
  listServiceHours:   vi.fn(),
  checkAvailability:  vi.fn(),
  getGuestNoShowCount: vi.fn(),
}))

import { reservationsRoutes } from '../routes/reservations.routes.js'
import * as service from '../services/reservations.service.js'

const IDENTITY = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'host' }

async function buildApp() {
  const app = Fastify({ logger: false })
  // Mirror the zod type-provider wiring the restaurant orchestrator installs so
  // `schema: { body/querystring/params }` (zod) validates here too.
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
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.validation) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.message } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.message } })
  })
  await app.register(reservationsRoutes)
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const validReservation = {
  guestName: 'Ana', guestEmail: 'ana@x.com', partySize: 4,
  reservedFor: '2026-05-01T20:00:00.000Z',
}

describe('POST /v1/reservations', () => {
  it('201 + delegates with ctx from identity', async () => {
    service.createReservation.mockResolvedValue({ id: 'r1', status: 'requested' })
    const res = await app.inject({ method: 'POST', url: '/v1/reservations', payload: validReservation })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('r1')
    expect(service.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1', userId: 'u1' }),
      expect.objectContaining({ guestName: 'Ana', partySize: 4 }),
    )
  })

  it('rejects invalid body (zod)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/reservations', payload: { guestName: '' } })
    expect(res.statusCode).toBe(400)
    expect(service.createReservation).not.toHaveBeenCalled()
  })
})

describe('GET /v1/reservations', () => {
  it('forwards from/to/status/limit query', async () => {
    service.listReservations.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reservations?from=A&to=B&status=confirmed&limit=5',
    })
    expect(res.statusCode).toBe(200)
    expect(service.listReservations).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan' }),
      { from: 'A', to: 'B', status: 'confirmed', limit: 5 },
    )
  })

  it('limit undefined when absent', async () => {
    service.listReservations.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/reservations' })
    expect(service.listReservations).toHaveBeenCalledWith(
      expect.anything(),
      { from: undefined, to: undefined, status: undefined, limit: undefined },
    )
  })
})

describe('GET /v1/reservations/:id', () => {
  it('delegates with id', async () => {
    service.getReservation.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({ method: 'GET', url: '/v1/reservations/r1' })
    expect(res.statusCode).toBe(200)
    expect(service.getReservation).toHaveBeenCalledWith(expect.anything(), 'r1')
  })
})

describe('PATCH /v1/reservations/:id/status', () => {
  it('delegates status + tableId', async () => {
    service.changeStatus.mockResolvedValue({ id: 'r1', status: 'seated' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/reservations/r1/status',
      payload: { status: 'seated', tableId: '22222222-2222-2222-2222-222222222222' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeStatus).toHaveBeenCalledWith(
      expect.anything(), 'r1', 'seated', '22222222-2222-2222-2222-222222222222',
      { cancelledBy: undefined, cancellationReason: undefined },
    )
  })

  it('forwards cancelledBy + cancellationReason on cancel', async () => {
    service.changeStatus.mockResolvedValue({ id: 'r1', status: 'cancelled' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/reservations/r1/status',
      payload: { status: 'cancelled', cancelledBy: 'guest', cancellationReason: 'changed plans' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeStatus).toHaveBeenCalledWith(
      expect.anything(), 'r1', 'cancelled', undefined,
      { cancelledBy: 'guest', cancellationReason: 'changed plans' },
    )
  })

  it('rejects invalid status enum', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/reservations/r1/status', payload: { status: 'bogus' },
    })
    expect(res.statusCode).toBe(400)
    expect(service.changeStatus).not.toHaveBeenCalled()
  })
})

describe('GET /v1/reservations/availability', () => {
  it('forwards date + coerced partySize', async () => {
    service.checkAvailability.mockResolvedValue({ date: '2026-05-01', windows: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/reservations/availability?date=2026-05-01&partySize=4' })
    expect(res.statusCode).toBe(200)
    expect(service.checkAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan' }),
      { date: '2026-05-01', partySize: 4 },
    )
  })

  it('rejects malformed date', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reservations/availability?date=05-2026' })
    expect(res.statusCode).toBe(400)
    expect(service.checkAvailability).not.toHaveBeenCalled()
  })
})

describe('GET /v1/reservations/no-shows', () => {
  it('forwards guestEmail', async () => {
    service.getGuestNoShowCount.mockResolvedValue({ count: 1 })
    const res = await app.inject({ method: 'GET', url: '/v1/reservations/no-shows?guestEmail=g@a.com' })
    expect(res.statusCode).toBe(200)
    expect(service.getGuestNoShowCount).toHaveBeenCalledWith(
      expect.anything(), { guestUserId: undefined, guestEmail: 'g@a.com' },
    )
  })
})

describe('waitlist routes', () => {
  it('POST /waitlist → 201', async () => {
    service.addToWaitlist.mockResolvedValue({ id: 'w1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/reservations/waitlist',
      payload: { guestName: 'X', partySize: 2 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addToWaitlist).toHaveBeenCalled()
  })

  it('GET /waitlist forwards status filter', async () => {
    service.listWaitlist.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/reservations/waitlist?status=waiting' })
    expect(service.listWaitlist).toHaveBeenCalledWith(expect.anything(), { status: 'waiting' })
  })

  it('POST /waitlist/:id/notify delegates', async () => {
    service.notifyWaitlist.mockResolvedValue({ id: 'w1' })
    const res = await app.inject({ method: 'POST', url: '/v1/reservations/waitlist/w1/notify' })
    expect(res.statusCode).toBe(200)
    expect(service.notifyWaitlist).toHaveBeenCalledWith(expect.anything(), 'w1')
  })
})

describe('service-hours routes', () => {
  it('POST /service-hours → 201', async () => {
    service.createServiceHours.mockResolvedValue({ id: 's1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/reservations/service-hours',
      payload: { dayOfWeek: 1, openMinute: 480, closeMinute: 1320 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createServiceHours).toHaveBeenCalled()
  })

  it('GET /service-hours delegates', async () => {
    service.listServiceHours.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/reservations/service-hours' })
    expect(res.statusCode).toBe(200)
    expect(service.listServiceHours).toHaveBeenCalledWith(expect.anything())
  })
})
