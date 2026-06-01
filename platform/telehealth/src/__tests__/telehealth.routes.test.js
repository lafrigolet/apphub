// telehealth.routes — superficie autenticada de salas/tokens de video.
// Valida delegación al service con el ctx derivado de req.identity, status
// codes (201 create room / issue token), parsing zod de bodies, y propagación
// del :id de la ruta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/telehealth.service.js', () => ({
  createRoom: vi.fn(),
  getRoom:    vi.fn(),
  issueToken: vi.fn(),
  endRoom:    vi.fn(),
  cancelRoom: vi.fn(),
}))

import { telehealthRoutes } from '../routes/telehealth.routes.js'
import * as service from '../services/telehealth.service.js'

const IDENTITY = { appId: 'yoga', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'practitioner' }
const START = '2030-01-01T10:00:00.000Z'
const END = '2030-01-01T11:00:00.000Z'

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
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = { ...IDENTITY } })
  await app.register(telehealthRoutes)
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

describe('POST /v1/telehealth/rooms', () => {
  it('201 + delega en service.createRoom con ctx y body', async () => {
    service.createRoom.mockResolvedValue({ id: 'room1', status: 'created' })
    const res = await app.inject({
      method: 'POST', url: '/v1/telehealth/rooms',
      headers: { 'Content-Type': 'application/json' },
      payload: { startsAt: START, endsAt: END, recordingEnabled: true },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('room1')
    expect(service.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'yoga', tenantId: 't1', userId: 'u1' }),
      expect.objectContaining({ startsAt: START, endsAt: END, recordingEnabled: true }),
    )
  })

  it('rechaza body inválido (fechas no datetime)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/telehealth/rooms',
      headers: { 'Content-Type': 'application/json' },
      payload: { startsAt: 'nope', endsAt: 'nope' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createRoom).not.toHaveBeenCalled()
  })
})

describe('GET /v1/telehealth/rooms/:id', () => {
  it('delega en service.getRoom con el id', async () => {
    service.getRoom.mockResolvedValue({ id: 'room1' })
    const res = await app.inject({ method: 'GET', url: '/v1/telehealth/rooms/room1' })
    expect(res.statusCode).toBe(200)
    expect(service.getRoom).toHaveBeenCalledWith(expect.objectContaining({ appId: 'yoga' }), 'room1')
  })
})

describe('POST /v1/telehealth/rooms/:id/tokens', () => {
  it('201 + delega en service.issueToken con roomId y body', async () => {
    service.issueToken.mockResolvedValue({ id: 'tok1', token: 'xyz' })
    const res = await app.inject({
      method: 'POST', url: '/v1/telehealth/rooms/room1/tokens',
      headers: { 'Content-Type': 'application/json' },
      payload: { participantRole: 'host' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().token).toBe('xyz')
    expect(service.issueToken).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'yoga' }), 'room1',
      expect.objectContaining({ participantRole: 'host' }),
    )
  })

  it('rechaza participantRole fuera del enum', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/telehealth/rooms/room1/tokens',
      headers: { 'Content-Type': 'application/json' },
      payload: { participantRole: 'admin' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.issueToken).not.toHaveBeenCalled()
  })
})

describe('POST /v1/telehealth/rooms/:id/end', () => {
  it('delega en service.endRoom', async () => {
    service.endRoom.mockResolvedValue({ id: 'room1', status: 'ended' })
    const res = await app.inject({ method: 'POST', url: '/v1/telehealth/rooms/room1/end' })
    expect(res.statusCode).toBe(200)
    expect(service.endRoom).toHaveBeenCalledWith(expect.anything(), 'room1')
  })
})

describe('POST /v1/telehealth/rooms/:id/cancel', () => {
  it('delega en service.cancelRoom', async () => {
    service.cancelRoom.mockResolvedValue({ id: 'room1', status: 'cancelled' })
    const res = await app.inject({ method: 'POST', url: '/v1/telehealth/rooms/room1/cancel' })
    expect(res.statusCode).toBe(200)
    expect(service.cancelRoom).toHaveBeenCalledWith(expect.anything(), 'room1')
  })
})
