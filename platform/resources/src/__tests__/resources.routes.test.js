// resources.routes — HTTP surface. Asserts delegation with ctx from
// req.identity, status codes (201/204/200), query/param forwarding and zod
// validation rejection. Service is fully mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/resources.service.js', () => ({
  createResource:           vi.fn(),
  listResources:            vi.fn(),
  getResource:              vi.fn(),
  listResourcesForService:  vi.fn(),
  attachService:            vi.fn(),
  detachService:            vi.fn(),
  setWorkHour:              vi.fn(),
  listWorkHours:            vi.fn(),
  deleteWorkHour:           vi.fn(),
  createException:          vi.fn(),
  listExceptions:           vi.fn(),
}))

import { resourcesRoutes } from '../routes/resources.routes.js'
import * as service from '../services/resources.service.js'

const IDENTITY = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'admin' }
const UUID = '22222222-2222-2222-2222-222222222222'

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = IDENTITY })
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.validation) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(400).send({ error: { code: 'BAD_REQUEST' } })
  })
  await app.register(resourcesRoutes)
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/resources', () => {
  it('201 + delegates with ctx', async () => {
    service.createResource.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/resources',
      payload: { kind: 'practitioner', displayName: 'Dr. Ana' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createResource).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1', subTenantId: null }),
      expect.objectContaining({ kind: 'practitioner' }),
    )
  })

  it('rejects invalid kind enum', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/resources', payload: { kind: 'bogus', displayName: 'X' },
    })
    expect(res.statusCode).toBe(400)
    expect(service.createResource).not.toHaveBeenCalled()
  })
})

describe('GET /v1/resources', () => {
  it('onlyActive true by default, kind forwarded', async () => {
    service.listResources.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/resources?kind=room' })
    expect(service.listResources).toHaveBeenCalledWith(
      expect.anything(), { kind: 'room', onlyActive: true },
    )
  })

  it('onlyActive=false disables active filter', async () => {
    service.listResources.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/resources?onlyActive=false' })
    expect(service.listResources).toHaveBeenCalledWith(
      expect.anything(), { kind: undefined, onlyActive: false },
    )
  })
})

describe('GET /v1/resources/:id', () => {
  it('delegates with id', async () => {
    service.getResource.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({ method: 'GET', url: '/v1/resources/r1' })
    expect(res.statusCode).toBe(200)
    expect(service.getResource).toHaveBeenCalledWith(expect.anything(), 'r1')
  })
})

describe('GET /v1/resources/by-service/:serviceId', () => {
  it('delegates with serviceId', async () => {
    service.listResourcesForService.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/resources/by-service/s1' })
    expect(res.statusCode).toBe(200)
    expect(service.listResourcesForService).toHaveBeenCalledWith(expect.anything(), 's1')
  })
})

describe('attach / detach service', () => {
  it('POST attach → 204', async () => {
    service.attachService.mockResolvedValue()
    const res = await app.inject({ method: 'POST', url: '/v1/resources/r1/services/s1' })
    expect(res.statusCode).toBe(204)
    expect(service.attachService).toHaveBeenCalledWith(expect.anything(), 'r1', 's1')
  })

  it('DELETE detach → 204', async () => {
    service.detachService.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: '/v1/resources/r1/services/s1' })
    expect(res.statusCode).toBe(204)
    expect(service.detachService).toHaveBeenCalledWith(expect.anything(), 'r1', 's1')
  })
})

describe('work hours routes', () => {
  it('POST /work-hours → 201', async () => {
    service.setWorkHour.mockResolvedValue({ id: 'wh1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/resources/work-hours',
      payload: { resourceId: UUID, dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.setWorkHour).toHaveBeenCalled()
  })

  it('rejects invalid work-hour body', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/resources/work-hours',
      payload: { resourceId: 'not-uuid', dayOfWeek: 9, startMinute: 0, endMinute: 0 },
    })
    expect(res.statusCode).toBe(400)
    expect(service.setWorkHour).not.toHaveBeenCalled()
  })

  it('GET /:id/work-hours delegates', async () => {
    service.listWorkHours.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/resources/r1/work-hours' })
    expect(res.statusCode).toBe(200)
    expect(service.listWorkHours).toHaveBeenCalledWith(expect.anything(), 'r1')
  })

  it('DELETE /work-hours/:id → 204', async () => {
    service.deleteWorkHour.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: '/v1/resources/work-hours/wh1' })
    expect(res.statusCode).toBe(204)
    expect(service.deleteWorkHour).toHaveBeenCalledWith(expect.anything(), 'wh1')
  })
})

describe('exceptions routes', () => {
  it('POST /exceptions → 201', async () => {
    service.createException.mockResolvedValue({ id: 'e1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/resources/exceptions',
      payload: {
        resourceId: UUID, startsAt: '2026-05-01T08:00:00.000Z',
        endsAt: '2026-05-08T08:00:00.000Z', kind: 'vacation',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createException).toHaveBeenCalled()
  })

  it('GET /:id/exceptions forwards from/to', async () => {
    service.listExceptions.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/resources/r1/exceptions?from=A&to=B' })
    expect(service.listExceptions).toHaveBeenCalledWith(expect.anything(), 'r1', { from: 'A', to: 'B' })
  })
})
