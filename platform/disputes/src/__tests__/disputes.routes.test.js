// disputes.routes — delegación al service con ctx derivado de req.identity,
// validación zod (422/400) y códigos de estado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/disputes.service.js', () => ({
  openDispute:             vi.fn(),
  listDisputes:            vi.fn(),
  getDispute:              vi.fn(),
  postMessage:             vi.fn(),
  uploadEvidence:          vi.fn(),
  resolve:                 vi.fn(),
  submitEvidenceToStripe:  vi.fn(),
}))

import { disputesRoutes } from '../routes/disputes.routes.js'
import * as service from '../services/disputes.service.js'

const ORDER_ID = '22222222-2222-2222-2222-222222222222'
const DIS_ID   = '11111111-1111-1111-1111-111111111111'

let identity = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'buyer' }

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
  await app.register(disputesRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    if (err.validation) return reply.status(422).send({ error: { code: 'VALIDATION' } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  identity = { appId: 'aikikan', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'buyer' }
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('POST /v1/disputes', () => {
  it('201 + delega con ctx derivado de identity', async () => {
    service.openDispute.mockResolvedValue({ id: DIS_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/disputes',
      payload: { orderId: ORDER_ID, reason: 'not_received', description: 'x' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe(DIS_ID)
    expect(service.openDispute).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1', userId: 'u1', role: 'buyer' }),
      expect.objectContaining({ orderId: ORDER_ID, reason: 'not_received' }),
    )
  })

  it('422 con body inválido (orderId no uuid)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/disputes',
      payload: { orderId: 'nope', reason: 'x' },
    })
    expect([400, 422]).toContain(res.statusCode)
    expect(service.openDispute).not.toHaveBeenCalled()
  })
})

describe('GET /v1/disputes', () => {
  it('lista con filtros de query', async () => {
    service.listDisputes.mockResolvedValue([{ id: DIS_ID }])
    const res = await app.inject({ method: 'GET', url: '/v1/disputes?status=open&limit=10' })
    expect(res.statusCode).toBe(200)
    expect(service.listDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan' }),
      expect.objectContaining({ status: 'open', limit: 10 }),
    )
  })
})

describe('GET /v1/disputes/:id', () => {
  it('200 devuelve el dispute', async () => {
    service.getDispute.mockResolvedValue({ id: DIS_ID, messages: [], evidence: [] })
    const res = await app.inject({ method: 'GET', url: `/v1/disputes/${DIS_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getDispute).toHaveBeenCalledWith(expect.anything(), DIS_ID)
  })
})

describe('POST /v1/disputes/:id/messages', () => {
  it('201 publica mensaje', async () => {
    service.postMessage.mockResolvedValue({ id: 'm1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/disputes/${DIS_ID}/messages`,
      payload: { body: 'hola', attachments: [{ url: 'x' }] },
    })
    expect(res.statusCode).toBe(201)
    expect(service.postMessage).toHaveBeenCalledWith(expect.anything(), DIS_ID, 'hola', [{ url: 'x' }])
  })

  it('422 con body vacío', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/disputes/${DIS_ID}/messages`,
      payload: { body: '' },
    })
    expect([400, 422]).toContain(res.statusCode)
  })
})

describe('POST /v1/disputes/:id/evidence', () => {
  it('201 sube evidencia', async () => {
    service.uploadEvidence.mockResolvedValue({ id: 'e1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/disputes/${DIS_ID}/evidence`,
      payload: { kind: 'photo', data: { url: 'x' } },
    })
    expect(res.statusCode).toBe(201)
    expect(service.uploadEvidence).toHaveBeenCalledWith(expect.anything(), DIS_ID, 'photo', { url: 'x' })
  })
})

describe('PATCH /v1/disputes/:id/resolve', () => {
  it('200 resuelve', async () => {
    service.resolve.mockResolvedValue({ id: DIS_ID, status: 'resolved_buyer' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/disputes/${DIS_ID}/resolve`,
      payload: { status: 'resolved_buyer', resolutionAmountCents: 500 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.resolve).toHaveBeenCalledWith(expect.anything(), DIS_ID, expect.objectContaining({ status: 'resolved_buyer' }))
  })

  it('422 con status inválido', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/disputes/${DIS_ID}/resolve`,
      payload: { status: 'bogus' },
    })
    expect([400, 422]).toContain(res.statusCode)
  })

  it('propaga ForbiddenError del service (403)', async () => {
    const err = new Error('only staff'); err.statusCode = 403; err.code = 'FORBIDDEN'
    service.resolve.mockRejectedValue(err)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/disputes/${DIS_ID}/resolve`,
      payload: { status: 'resolved_buyer' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /v1/disputes/:id/submit-to-stripe', () => {
  it('200 reenvía evidencia a Stripe', async () => {
    service.submitEvidenceToStripe.mockResolvedValue({ ok: true, items: 2 })
    const res = await app.inject({ method: 'POST', url: `/v1/disputes/${DIS_ID}/submit-to-stripe` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, items: 2 })
    expect(service.submitEvidenceToStripe).toHaveBeenCalledWith(expect.anything(), DIS_ID)
  })
})
