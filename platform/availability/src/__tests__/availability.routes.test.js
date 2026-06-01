// availability.routes — slots (GET), holds (POST 201 / DELETE 204). Mockea
// el service; verifica delegación con el ctx derivado del identity y la
// validación zod (422/400 ante body/query inválidos).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { ZodError } from 'zod'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../services/availability.service.js', () => ({
  listSlots: vi.fn(),
  holdSlot: vi.fn(),
  releaseHold: vi.fn(),
}))

import { availabilityRoutes } from '../routes/availability.routes.js'
import * as service from '../services/availability.service.js'

const APP = 'yoga'
const TENANT = '00000000-0000-0000-0000-000000000001'
const SVC = '11111111-1111-1111-1111-111111111111'
const RES = '22222222-2222-2222-2222-222222222222'
const FROM = '2026-06-01T00:00:00.000Z'
const TO = '2026-06-02T00:00:00.000Z'

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
    req.identity = { appId: APP, tenantId: TENANT, subTenantId: null, userId: 'u1', role: 'buyer' }
  })
  await app.register(availabilityRoutes)
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

describe('GET /v1/availability/slots', () => {
  it('delega a listSlots con ctx + query', async () => {
    service.listSlots.mockResolvedValue([{ start: FROM }])
    const res = await app.inject({
      method: 'GET',
      url: `/v1/availability/slots?serviceId=${SVC}&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(service.listSlots).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP, tenantId: TENANT, userId: 'u1' }),
      expect.objectContaining({ serviceId: SVC, from: FROM, to: TO }),
    )
  })

  it('query inválida (serviceId no uuid) → 422', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/availability/slots?serviceId=nope&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: auth,
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.listSlots).not.toHaveBeenCalled()
  })

  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/availability/slots' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /v1/availability/holds', () => {
  it('201 con el hold creado', async () => {
    service.holdSlot.mockResolvedValue({ id: 'hold1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/availability/holds', headers: json,
      payload: { serviceId: SVC, resourceId: RES, startsAt: FROM, endsAt: TO, ttlSeconds: 600 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('hold1')
    expect(service.holdSlot).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP }),
      expect.objectContaining({ serviceId: SVC, resourceId: RES }),
    )
  })

  it('body inválido → 422', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/availability/holds', headers: json,
      payload: { serviceId: SVC },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.holdSlot).not.toHaveBeenCalled()
  })

  it('conflicto de service propaga statusCode', async () => {
    const err = new Error('overlap'); err.statusCode = 409; err.code = 'CONFLICT'
    service.holdSlot.mockRejectedValue(err)
    const res = await app.inject({
      method: 'POST', url: '/v1/availability/holds', headers: json,
      payload: { serviceId: SVC, resourceId: RES, startsAt: FROM, endsAt: TO },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('DELETE /v1/availability/holds/:id', () => {
  it('204 tras releaseHold', async () => {
    service.releaseHold.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: '/v1/availability/holds/hold1', headers: auth })
    expect(res.statusCode).toBe(204)
    expect(service.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ appId: APP }), 'hold1')
  })
})
