// messaging.routes — wiring HTTP → service. Verifica status codes (201 creates,
// 204 read/detach), delegación con ctx de req.identity, parsing de params/query
// (role buyer|vendor, limit/offset) y validación zod de bodies.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/messaging.service.js', () => ({
  createThread:           vi.fn(),
  listThreads:            vi.fn(),
  getThread:              vi.fn(),
  listMessages:           vi.fn(),
  postMessage:            vi.fn(),
  markRead:               vi.fn(),
  markThreadRead:         vi.fn(),
  getThreadUnreadCount:   vi.fn(),
  getUnreadCounts:        vi.fn(),
  listMessageAttachments: vi.fn(),
  attachToMessage:        vi.fn(),
  detachFromMessage:      vi.fn(),
}))

import { messagingRoutes } from '../routes/messaging.routes.js'
import * as service from '../services/messaging.service.js'

const IDENTITY = { appId: 'mk', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'user' }

async function buildApp() {
  const app = Fastify({ logger: false })
  // Compiler zod passthrough (los schemas declarados son zod objects).
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
  await app.register(messagingRoutes)
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

const TH = '11111111-1111-1111-1111-111111111111'
const MID = '22222222-2222-2222-2222-222222222222'
const ATT = '33333333-3333-3333-3333-333333333333'
const U = '44444444-4444-4444-4444-444444444444'
const OBJ = '55555555-5555-5555-5555-555555555555'

describe('POST /v1/messages/threads', () => {
  it('201 + delega createThread con ctx', async () => {
    service.createThread.mockResolvedValue({ id: TH })
    const res = await app.inject({
      method: 'POST', url: '/v1/messages/threads',
      headers: { 'Content-Type': 'application/json' },
      payload: { buyerUserId: U, vendorUserId: U },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'mk', tenantId: 't1', userId: 'u1' }),
      expect.objectContaining({ buyerUserId: U, vendorUserId: U }),
    )
  })

  it('body inválido → rechazado', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/messages/threads',
      headers: { 'Content-Type': 'application/json' },
      payload: { buyerUserId: 'not-uuid' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createThread).not.toHaveBeenCalled()
  })
})

describe('GET /v1/messages/threads', () => {
  it('?role=vendor → listThreads con vendor', async () => {
    service.listThreads.mockResolvedValue([{ id: TH }])
    const res = await app.inject({ method: 'GET', url: '/v1/messages/threads?role=vendor' })
    expect(res.statusCode).toBe(200)
    expect(service.listThreads).toHaveBeenCalledWith(expect.anything(), 'vendor')
  })

  it('sin role → default buyer', async () => {
    service.listThreads.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/messages/threads' })
    expect(service.listThreads).toHaveBeenCalledWith(expect.anything(), 'buyer')
  })
})

describe('GET /v1/messages/threads/:id', () => {
  it('delega getThread con el id', async () => {
    service.getThread.mockResolvedValue({ id: TH })
    const res = await app.inject({ method: 'GET', url: `/v1/messages/threads/${TH}` })
    expect(res.statusCode).toBe(200)
    expect(service.getThread).toHaveBeenCalledWith(expect.anything(), TH)
  })
})

describe('GET /v1/messages/threads/:id/messages', () => {
  it('parsea limit/offset de query', async () => {
    service.listMessages.mockResolvedValue([{ id: MID }])
    const res = await app.inject({ method: 'GET', url: `/v1/messages/threads/${TH}/messages?limit=5&offset=10` })
    expect(res.statusCode).toBe(200)
    expect(service.listMessages).toHaveBeenCalledWith(expect.anything(), TH, { limit: 5, offset: 10 })
  })

  it('sin query → limit/offset undefined', async () => {
    service.listMessages.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/messages/threads/${TH}/messages` })
    expect(service.listMessages).toHaveBeenCalledWith(expect.anything(), TH, { limit: undefined, offset: undefined })
  })
})

describe('POST /v1/messages/threads/:id/messages', () => {
  it('201 + delega postMessage con body + attachments', async () => {
    service.postMessage.mockResolvedValue({ id: MID })
    const res = await app.inject({
      method: 'POST', url: `/v1/messages/threads/${TH}/messages`,
      headers: { 'Content-Type': 'application/json' },
      payload: { body: 'hola', attachments: [{ k: 1 }] },
    })
    expect(res.statusCode).toBe(201)
    expect(service.postMessage).toHaveBeenCalledWith(expect.anything(), TH, 'hola', [{ k: 1 }])
  })

  it('body vacío → rechazado', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/messages/threads/${TH}/messages`,
      headers: { 'Content-Type': 'application/json' },
      payload: { body: '' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.postMessage).not.toHaveBeenCalled()
  })
})

describe('POST .../messages/:mid/read', () => {
  it('204 + delega markRead', async () => {
    service.markRead.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'POST', url: `/v1/messages/threads/${TH}/messages/${MID}/read` })
    expect(res.statusCode).toBe(204)
    expect(service.markRead).toHaveBeenCalledWith(expect.anything(), TH, MID)
  })
})

describe('GET /v1/messages/unread-counts', () => {
  it('delega getUnreadCounts con ctx', async () => {
    service.getUnreadCounts.mockResolvedValue({ total: 3, threads: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/messages/unread-counts' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 3, threads: [] })
    expect(service.getUnreadCounts).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
  })
})

describe('GET /v1/messages/threads/:id/unread-count', () => {
  it('delega getThreadUnreadCount con el id', async () => {
    service.getThreadUnreadCount.mockResolvedValue({ threadId: TH, unread: 1 })
    const res = await app.inject({ method: 'GET', url: `/v1/messages/threads/${TH}/unread-count` })
    expect(res.statusCode).toBe(200)
    expect(service.getThreadUnreadCount).toHaveBeenCalledWith(expect.anything(), TH)
  })
})

describe('POST /v1/messages/threads/:id/read-all', () => {
  it('delega markThreadRead y devuelve { marked }', async () => {
    service.markThreadRead.mockResolvedValue({ marked: 4 })
    const res = await app.inject({ method: 'POST', url: `/v1/messages/threads/${TH}/read-all` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ marked: 4 })
    expect(service.markThreadRead).toHaveBeenCalledWith(expect.anything(), TH)
  })
})

describe('GET .../attachments', () => {
  it('lista attachments envueltos en {data}', async () => {
    service.listMessageAttachments.mockResolvedValue([{ id: ATT }])
    const res = await app.inject({ method: 'GET', url: `/v1/messages/threads/${TH}/messages/${MID}/attachments` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: ATT }] })
    expect(service.listMessageAttachments).toHaveBeenCalledWith(expect.anything(), TH, MID)
  })
})

describe('POST .../attachments', () => {
  it('201 + delega attachToMessage', async () => {
    service.attachToMessage.mockResolvedValue({ id: ATT })
    const res = await app.inject({
      method: 'POST', url: `/v1/messages/threads/${TH}/messages/${MID}/attachments`,
      headers: { 'Content-Type': 'application/json' },
      payload: { objectId: OBJ, kind: 'image' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.attachToMessage).toHaveBeenCalledWith(
      expect.anything(), TH, MID, expect.objectContaining({ objectId: OBJ, kind: 'image' }),
    )
  })

  it('kind inválido → rechazado', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/messages/threads/${TH}/messages/${MID}/attachments`,
      headers: { 'Content-Type': 'application/json' },
      payload: { objectId: OBJ, kind: 'NOPE' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.attachToMessage).not.toHaveBeenCalled()
  })
})

describe('DELETE .../attachments/:attachmentId', () => {
  it('204 + delega detachFromMessage', async () => {
    service.detachFromMessage.mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'DELETE', url: `/v1/messages/threads/${TH}/messages/${MID}/attachments/${ATT}`,
    })
    expect(res.statusCode).toBe(204)
    expect(service.detachFromMessage).toHaveBeenCalledWith(expect.anything(), TH, MID, ATT)
  })
})
