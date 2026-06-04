// resources.routes — HTTP surface. Asserts delegation with ctx from
// req.identity, status codes (201/204/200), query/param forwarding and zod
// validation rejection. Service is fully mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/resources.service.js', () => ({
  createResource:           vi.fn(),
  updateResource:           vi.fn(),
  setResourceActive:        vi.fn(),
  listResources:            vi.fn(),
  getResource:              vi.fn(),
  listResourcesForService:  vi.fn(),
  attachService:            vi.fn(),
  detachService:            vi.fn(),
  setWorkHour:              vi.fn(),
  updateWorkHour:           vi.fn(),
  listWorkHours:            vi.fn(),
  deleteWorkHour:           vi.fn(),
  createException:          vi.fn(),
  updateException:          vi.fn(),
  deleteException:          vi.fn(),
  createTenantHolidays:     vi.fn(),
  listExceptions:           vi.fn(),
}))

import { resourcesRoutes } from '../routes/resources.routes.js'
import * as service from '../services/resources.service.js'

const IDENTITY = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'admin' }
const UUID = '22222222-2222-2222-2222-222222222222'
const RID  = '33333333-3333-3333-3333-333333333333'
const SID  = '44444444-4444-4444-4444-444444444444'
const WHID = '55555555-5555-5555-5555-555555555555'
const EXID = '66666666-6666-6666-6666-666666666666'

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
    service.getResource.mockResolvedValue({ id: RID })
    const res = await app.inject({ method: 'GET', url: `/v1/resources/${RID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getResource).toHaveBeenCalledWith(expect.anything(), RID)
  })
})

describe('GET /v1/resources/by-service/:serviceId', () => {
  it('delegates with serviceId', async () => {
    service.listResourcesForService.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: `/v1/resources/by-service/${SID}` })
    expect(res.statusCode).toBe(200)
    expect(service.listResourcesForService).toHaveBeenCalledWith(expect.anything(), SID)
  })
})

describe('attach / detach service', () => {
  it('POST attach → 204', async () => {
    service.attachService.mockResolvedValue()
    const res = await app.inject({ method: 'POST', url: `/v1/resources/${RID}/services/${SID}` })
    expect(res.statusCode).toBe(204)
    expect(service.attachService).toHaveBeenCalledWith(expect.anything(), RID, SID)
  })

  it('DELETE detach → 204', async () => {
    service.detachService.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/resources/${RID}/services/${SID}` })
    expect(res.statusCode).toBe(204)
    expect(service.detachService).toHaveBeenCalledWith(expect.anything(), RID, SID)
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
    const res = await app.inject({ method: 'GET', url: `/v1/resources/${RID}/work-hours` })
    expect(res.statusCode).toBe(200)
    expect(service.listWorkHours).toHaveBeenCalledWith(expect.anything(), RID)
  })

  it('DELETE /work-hours/:id → 204', async () => {
    service.deleteWorkHour.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/resources/work-hours/${WHID}` })
    expect(res.statusCode).toBe(204)
    expect(service.deleteWorkHour).toHaveBeenCalledWith(expect.anything(), WHID)
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
    const from = '2026-01-01T00:00:00.000Z'
    const to   = '2026-02-01T00:00:00.000Z'
    await app.inject({ method: 'GET', url: `/v1/resources/${RID}/exceptions?from=${from}&to=${to}` })
    expect(service.listExceptions).toHaveBeenCalledWith(expect.anything(), RID, { from, to })
  })
})

describe('PATCH /v1/resources/:id', () => {
  it('200 + delegates patch', async () => {
    service.updateResource.mockResolvedValue({ id: RID })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/resources/${RID}`,
      payload: { displayName: 'New Name', timezone: 'Europe/Madrid' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateResource).toHaveBeenCalledWith(
      expect.anything(), RID, expect.objectContaining({ displayName: 'New Name', timezone: 'Europe/Madrid' }),
    )
  })

  it('rejects empty patch body', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/resources/${RID}`, payload: {} })
    expect(res.statusCode).toBe(400)
    expect(service.updateResource).not.toHaveBeenCalled()
  })
})

describe('PATCH /v1/resources/:id/active', () => {
  it('toggles active', async () => {
    service.setResourceActive.mockResolvedValue({ id: RID, is_active: false })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/resources/${RID}/active`, payload: { isActive: false },
    })
    expect(res.statusCode).toBe(200)
    expect(service.setResourceActive).toHaveBeenCalledWith(expect.anything(), RID, false)
  })

  it('rejects missing isActive', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/resources/${RID}/active`, payload: {} })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /v1/resources/work-hours/:id', () => {
  it('200 + delegates', async () => {
    service.updateWorkHour.mockResolvedValue({ id: WHID })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/resources/work-hours/${WHID}`, payload: { startMinute: 600 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateWorkHour).toHaveBeenCalledWith(expect.anything(), WHID, { startMinute: 600 })
  })
})

describe('exceptions update/delete routes', () => {
  it('PATCH /exceptions/:id → 200', async () => {
    service.updateException.mockResolvedValue({ id: EXID })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/resources/exceptions/${EXID}`, payload: { reason: 'fixed' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateException).toHaveBeenCalledWith(expect.anything(), EXID, { reason: 'fixed' })
  })

  it('DELETE /exceptions/:id → 204', async () => {
    service.deleteException.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/resources/exceptions/${EXID}` })
    expect(res.statusCode).toBe(204)
    expect(service.deleteException).toHaveBeenCalledWith(expect.anything(), EXID)
  })
})

describe('POST /v1/resources/holidays', () => {
  it('201 + bulk-create delegated', async () => {
    service.createTenantHolidays.mockResolvedValue({ created: 3, exceptions: [] })
    const res = await app.inject({
      method: 'POST', url: '/v1/resources/holidays',
      payload: {
        startsAt: '2026-12-25T00:00:00.000Z',
        endsAt:   '2026-12-26T00:00:00.000Z',
        reason:   'Christmas',
        kind:     'practitioner',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createTenantHolidays).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'Christmas', kind: 'practitioner' }),
    )
  })

  it('rejects invalid datetime', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/resources/holidays',
      payload: { startsAt: 'not-a-date', endsAt: '2026-12-26T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(400)
    expect(service.createTenantHolidays).not.toHaveBeenCalled()
  })
})
