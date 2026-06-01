// floor-plan.routes — delegación al service con ctx derivado de req.identity,
// validación zod y códigos de estado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/floor-plan.service.js', () => ({
  createSection:     vi.fn(),
  listSections:      vi.fn(),
  createTable:       vi.fn(),
  listTables:        vi.fn(),
  getTable:          vi.fn(),
  changeTableStatus: vi.fn(),
  combineTables:     vi.fn(),
}))

import { floorPlanRoutes } from '../routes/floor-plan.routes.js'
import * as service from '../services/floor-plan.service.js'

const TABLE_ID   = '11111111-1111-1111-1111-111111111111'
const SECTION_ID = '22222222-2222-2222-2222-222222222222'

const identity = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'staff' }

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
  await app.register(floorPlanRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    if (err.validation || err.name === 'ZodError') return reply.status(422).send({ error: { code: 'VALIDATION' } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/floor-plan/sections', () => {
  it('201 crea sección', async () => {
    service.createSection.mockResolvedValue({ id: SECTION_ID })
    const res = await app.inject({ method: 'POST', url: '/v1/floor-plan/sections', payload: { name: 'Terraza', isOutdoor: true } })
    expect(res.statusCode).toBe(201)
    expect(service.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1' }),
      expect.objectContaining({ name: 'Terraza', isOutdoor: true }),
    )
  })

  it('rechaza body inválido (name vacío)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/floor-plan/sections', payload: { name: '' } })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createSection).not.toHaveBeenCalled()
  })
})

describe('GET /v1/floor-plan/sections', () => {
  it('lista secciones', async () => {
    service.listSections.mockResolvedValue([{ id: SECTION_ID }])
    const res = await app.inject({ method: 'GET', url: '/v1/floor-plan/sections' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: SECTION_ID }])
    expect(service.listSections).toHaveBeenCalledWith(expect.objectContaining({ appId: 'aikikan' }))
  })
})

describe('POST /v1/floor-plan/tables', () => {
  it('201 crea mesa', async () => {
    service.createTable.mockResolvedValue({ id: TABLE_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/floor-plan/tables',
      payload: { sectionId: SECTION_ID, code: 'A1', capacity: 4, shape: 'round' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'A1', capacity: 4 }))
  })

  it('rechaza capacity no positivo', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/floor-plan/tables',
      payload: { sectionId: SECTION_ID, code: 'A1', capacity: 0 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})

describe('GET /v1/floor-plan/tables', () => {
  it('lista mesas pasando filtros de query', async () => {
    service.listTables.mockResolvedValue([{ id: TABLE_ID }])
    const res = await app.inject({ method: 'GET', url: '/v1/floor-plan/tables?sectionId=s1&status=free' })
    expect(res.statusCode).toBe(200)
    expect(service.listTables).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionId: 's1', status: 'free' }),
    )
  })
})

describe('GET /v1/floor-plan/tables/:id', () => {
  it('200 devuelve mesa', async () => {
    service.getTable.mockResolvedValue({ id: TABLE_ID })
    const res = await app.inject({ method: 'GET', url: `/v1/floor-plan/tables/${TABLE_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getTable).toHaveBeenCalledWith(expect.anything(), TABLE_ID)
  })

  it('404 propaga NotFoundError del service', async () => {
    const err = new Error('table'); err.statusCode = 404; err.code = 'NOT_FOUND'
    service.getTable.mockRejectedValue(err)
    const res = await app.inject({ method: 'GET', url: `/v1/floor-plan/tables/${TABLE_ID}` })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /v1/floor-plan/tables/:id/status', () => {
  it('cambia status pasando meta sin el status', async () => {
    service.changeTableStatus.mockResolvedValue({ id: TABLE_ID, status: 'occupied' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/floor-plan/tables/${TABLE_ID}/status`,
      payload: { status: 'occupied', partySize: 4 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.changeTableStatus).toHaveBeenCalledWith(
      expect.anything(), TABLE_ID, 'occupied', expect.objectContaining({ partySize: 4 }),
    )
  })

  it('rechaza status inválido', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/floor-plan/tables/${TABLE_ID}/status`,
      payload: { status: 'bogus' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })

  it('propaga ConflictError (409) de transición inválida', async () => {
    const err = new Error('cannot transition'); err.statusCode = 409; err.code = 'CONFLICT'
    service.changeTableStatus.mockRejectedValue(err)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/floor-plan/tables/${TABLE_ID}/status`,
      payload: { status: 'occupied' },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('POST /v1/floor-plan/tables/:id/combine', () => {
  it('combina mesas', async () => {
    service.combineTables.mockResolvedValue({ id: TABLE_ID })
    const res = await app.inject({
      method: 'POST', url: `/v1/floor-plan/tables/${TABLE_ID}/combine`,
      payload: { otherIds: [SECTION_ID] },
    })
    expect(res.statusCode).toBe(200)
    expect(service.combineTables).toHaveBeenCalledWith(expect.anything(), TABLE_ID, [SECTION_ID])
  })

  it('rechaza otherIds vacío', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/floor-plan/tables/${TABLE_ID}/combine`,
      payload: { otherIds: [] },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})
