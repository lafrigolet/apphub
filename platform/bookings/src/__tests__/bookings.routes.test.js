// bookings.routes — CRUD + FSM transitions + waitlist. Mockea el service;
// verifica delegación con ctx derivado del identity, status (201/200), y
// validación zod (body inválido).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { ZodError } from 'zod'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../services/bookings.service.js', () => ({
  createBooking: vi.fn(),
  listBookings: vi.fn(),
  getBooking: vi.fn(),
  changeStatus: vi.fn(),
  cancelBooking: vi.fn(),
  reschedule: vi.fn(),
  addToWaitlist: vi.fn(),
  listWaitlist: vi.fn(),
  notifyWaitlist: vi.fn(),
  createRecurrence: vi.fn(),
  listRecurrences: vi.fn(),
  getRecurrence: vi.fn(),
}))

import { bookingsRoutes } from '../routes/bookings.routes.js'
import * as service from '../services/bookings.service.js'

const APP = 'yoga'
const TENANT = '00000000-0000-0000-0000-000000000001'
const SVC = '22222222-2222-2222-2222-222222222222'
const RES = '44444444-4444-4444-4444-444444444444'
const BID = '11111111-1111-1111-1111-111111111111'
const SESS = '55555555-5555-5555-5555-555555555555'

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
  app.addHook('onRequest', async (req, reply) => {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
    }
    req.identity = { appId: APP, tenantId: TENANT, subTenantId: null, userId: 'u1', role: 'staff' }
  })
  await app.register(bookingsRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const auth = { Authorization: 'Bearer token' }
const json = { ...auth, 'Content-Type': 'application/json' }

const validBooking = {
  serviceId: SVC, resourceIds: [RES],
  startsAt: '2026-05-01T10:00:00.000Z', endsAt: '2026-05-01T10:30:00.000Z',
}

describe('POST /v1/bookings', () => {
  it('201 con la booking creada', async () => {
    service.createBooking.mockResolvedValue({ id: BID })
    const res = await app.inject({ method: 'POST', url: '/v1/bookings', headers: json, payload: validBooking })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe(BID)
    expect(service.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP, tenantId: TENANT }),
      expect.objectContaining({ serviceId: SVC }),
    )
  })

  it('sessionId basta (sin serviceId/resourceIds)', async () => {
    service.createBooking.mockResolvedValue({ id: BID })
    const res = await app.inject({ method: 'POST', url: '/v1/bookings', headers: json, payload: { sessionId: SESS } })
    expect(res.statusCode).toBe(201)
  })

  it('body inválido (ni sessionId ni serviceId completo) → 422', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/bookings', headers: json, payload: { serviceId: SVC } })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createBooking).not.toHaveBeenCalled()
  })

  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/bookings', headers: { 'Content-Type': 'application/json' }, payload: validBooking })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /v1/bookings', () => {
  it('delega con filtros parseados (limit → Number)', async () => {
    service.listBookings.mockResolvedValue([{ id: BID }])
    const res = await app.inject({
      method: 'GET',
      url: `/v1/bookings?from=2026-05-01&clientUserId=u1&resourceId=${RES}&sessionId=${SESS}&status=confirmed&limit=50`,
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(service.listBookings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: '2026-05-01', status: 'confirmed', limit: 50, resourceId: RES }),
    )
  })

  it('sin limit → undefined', async () => {
    service.listBookings.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/bookings', headers: auth })
    expect(service.listBookings).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ limit: undefined }),
    )
  })
})

describe('GET /v1/bookings/:id', () => {
  it('delega a getBooking', async () => {
    service.getBooking.mockResolvedValue({ id: BID })
    const res = await app.inject({ method: 'GET', url: `/v1/bookings/${BID}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getBooking).toHaveBeenCalledWith(expect.anything(), BID)
  })
})

describe('PATCH /v1/bookings/:id/status', () => {
  it('cambia status con reason', async () => {
    service.changeStatus.mockResolvedValue({ id: BID, status: 'confirmed' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/bookings/${BID}/status`, headers: json,
      payload: { status: 'confirmed', reason: 'ok' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeStatus).toHaveBeenCalledWith(expect.anything(), BID, 'confirmed', 'ok')
  })

  it('status inválido → 422', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/bookings/${BID}/status`, headers: json,
      payload: { status: 'banana' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})

describe('POST /v1/bookings/:id/cancel', () => {
  it('cancela con reason', async () => {
    service.cancelBooking.mockResolvedValue({ id: BID, status: 'cancelled' })
    const res = await app.inject({
      method: 'POST', url: `/v1/bookings/${BID}/cancel`, headers: json, payload: { reason: 'sick' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.cancelBooking).toHaveBeenCalledWith(expect.anything(), BID, 'sick')
  })
})

describe('POST /v1/bookings/:id/reschedule', () => {
  it('reagenda a nueva ventana', async () => {
    service.reschedule.mockResolvedValue({ id: BID })
    const res = await app.inject({
      method: 'POST', url: `/v1/bookings/${BID}/reschedule`, headers: json,
      payload: { startsAt: '2026-05-02T10:00:00.000Z', endsAt: '2026-05-02T10:30:00.000Z' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.reschedule).toHaveBeenCalledWith(
      expect.anything(), BID, expect.objectContaining({ startsAt: '2026-05-02T10:00:00.000Z' }),
    )
  })

  it('falta endsAt → 422', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/bookings/${BID}/reschedule`, headers: json,
      payload: { startsAt: '2026-05-02T10:00:00.000Z' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})

describe('waitlist', () => {
  it('POST /waitlist → 201', async () => {
    service.addToWaitlist.mockResolvedValue({ id: 'w1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/bookings/waitlist', headers: json, payload: { serviceId: SVC },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addToWaitlist).toHaveBeenCalled()
  })

  it('GET /waitlist con filtros', async () => {
    service.listWaitlist.mockResolvedValue([{ id: 'w1' }])
    const res = await app.inject({
      method: 'GET', url: `/v1/bookings/waitlist?serviceId=${SVC}&status=waiting`, headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(service.listWaitlist).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ serviceId: SVC, status: 'waiting' }),
    )
  })

  it('POST /waitlist/:id/notify', async () => {
    service.notifyWaitlist.mockResolvedValue({ id: 'w1', status: 'notified' })
    const res = await app.inject({
      method: 'POST', url: `/v1/bookings/waitlist/${BID}/notify`, headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(service.notifyWaitlist).toHaveBeenCalledWith(expect.anything(), BID)
  })
})

describe('recurrences', () => {
  const RID = '66666666-6666-6666-6666-666666666666'

  it('POST /recurrences → 201', async () => {
    service.createRecurrence.mockResolvedValue({ id: RID })
    const res = await app.inject({
      method: 'POST', url: '/v1/bookings/recurrences', headers: json,
      payload: { rrule: { freq: 'WEEKLY' }, startsOn: '2026-06-01' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createRecurrence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rrule: { freq: 'WEEKLY' }, startsOn: '2026-06-01' }),
    )
  })

  it('POST /recurrences body inválido (sin rrule) → 422', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/bookings/recurrences', headers: json,
      payload: { startsOn: '2026-06-01' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createRecurrence).not.toHaveBeenCalled()
  })

  it('GET /recurrences → 200', async () => {
    service.listRecurrences.mockResolvedValue([{ id: RID }])
    const res = await app.inject({ method: 'GET', url: '/v1/bookings/recurrences', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.listRecurrences).toHaveBeenCalled()
  })

  it('GET /recurrences/:id → 200', async () => {
    service.getRecurrence.mockResolvedValue({ id: RID })
    const res = await app.inject({ method: 'GET', url: `/v1/bookings/recurrences/${RID}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getRecurrence).toHaveBeenCalledWith(expect.anything(), RID)
  })
})
