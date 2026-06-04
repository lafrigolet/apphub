// storage.routes — superficie pública/autenticada del módulo storage.
// Valida: ruta pública /kinds (sin auth), delegación al service con el ctx
// derivado de req.identity, status codes (201 upload, 204 delete) y parsing
// zod de body/query.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/storage.service.js', () => ({
  requestUpload:  vi.fn(),
  finalize:       vi.fn(),
  getObject:      vi.fn(),
  getDownloadUrl: vi.fn(),
  deleteObject:   vi.fn(),
  restoreObject:  vi.fn(),
  listObjects:    vi.fn(),
  getUsage:       vi.fn(),
}))

import { storageRoutes } from '../routes/storage.routes.js'
import * as service from '../services/storage.service.js'

const IDENTITY = {
  appId: 'yoga', tenantId: 't1', subTenantId: null,
  userId: 'u1', role: 'user',
}

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
  // inyecta identity en cada request salvo rutas públicas
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => {
    if (req.routeOptions?.config?.public) return
    req.identity = { ...IDENTITY }
  })
  await app.register(storageRoutes)
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

describe('GET /v1/storage/kinds (público)', () => {
  it('lista los kinds sin auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/storage/kinds' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toContain('menu_photo')
  })
})

describe('POST /v1/storage/uploads', () => {
  it('201 + delega en service.requestUpload con ctx', async () => {
    service.requestUpload.mockResolvedValue({ objectId: 'o1', uploadUrl: 'http://x' })
    const res = await app.inject({
      method: 'POST', url: '/v1/storage/uploads',
      headers: { 'Content-Type': 'application/json' },
      payload: { kind: 'menu_photo', contentType: 'image/png', sizeBytes: 500 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().objectId).toBe('o1')
    expect(service.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'yoga', tenantId: 't1', userId: 'u1', role: 'user' }),
      expect.objectContaining({ kind: 'menu_photo', contentType: 'image/png', sizeBytes: 500 }),
    )
  })

  it('rechaza body inválido (zod)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/storage/uploads',
      headers: { 'Content-Type': 'application/json' },
      payload: { kind: '', contentType: 'image/png', sizeBytes: -1 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.requestUpload).not.toHaveBeenCalled()
  })
})

describe('POST /v1/storage/objects/:id/finalize', () => {
  it('delega en service.finalize con el id', async () => {
    service.finalize.mockResolvedValue({ id: 'o1', status: 'uploaded' })
    const res = await app.inject({ method: 'POST', url: '/v1/storage/objects/o1/finalize' })
    expect(res.statusCode).toBe(200)
    expect(service.finalize).toHaveBeenCalledWith(expect.objectContaining({ appId: 'yoga' }), 'o1')
  })
})

describe('GET /v1/storage/objects/:id', () => {
  it('devuelve metadata del service', async () => {
    service.getObject.mockResolvedValue({ id: 'o1' })
    const res = await app.inject({ method: 'GET', url: '/v1/storage/objects/o1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('o1')
  })
})

describe('GET /v1/storage/objects/:id/download-url', () => {
  it('usa ttl por defecto (300) cuando no se pasa', async () => {
    service.getDownloadUrl.mockResolvedValue({ downloadUrl: 'http://d' })
    const res = await app.inject({ method: 'GET', url: '/v1/storage/objects/o1/download-url' })
    expect(res.statusCode).toBe(200)
    expect(service.getDownloadUrl).toHaveBeenCalledWith(expect.anything(), 'o1', 300, expect.objectContaining({ ip: expect.anything(), userAgent: expect.anything() }))
  })

  it('respeta ttl explícito del query', async () => {
    service.getDownloadUrl.mockResolvedValue({ downloadUrl: 'http://d' })
    await app.inject({ method: 'GET', url: '/v1/storage/objects/o1/download-url?ttl=120' })
    expect(service.getDownloadUrl).toHaveBeenCalledWith(expect.anything(), 'o1', 120, expect.objectContaining({ ip: expect.anything(), userAgent: expect.anything() }))
  })
})

describe('DELETE /v1/storage/objects/:id', () => {
  it('204 sin body', async () => {
    service.deleteObject.mockResolvedValue({ id: 'o1', status: 'deleted' })
    const res = await app.inject({ method: 'DELETE', url: '/v1/storage/objects/o1' })
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(service.deleteObject).toHaveBeenCalledWith(expect.anything(), 'o1', { hard: false })
  })

  it('hard delete por staff → pasa { hard: true }', async () => {
    service.deleteObject.mockResolvedValue({ id: 'o1', status: 'purged' })
    const res = await app.inject({ method: 'DELETE', url: '/v1/storage/objects/o1?hard=true' })
    // identity por defecto es user → 403; comprobamos el gate por rol
    expect(res.statusCode).toBe(403)
    expect(service.deleteObject).not.toHaveBeenCalled()
  })
})

describe('POST /v1/storage/objects/:id/restore', () => {
  it('delega en service.restoreObject', async () => {
    service.restoreObject.mockResolvedValue({ id: 'o1', status: 'uploaded' })
    const res = await app.inject({ method: 'POST', url: '/v1/storage/objects/o1/restore' })
    expect(res.statusCode).toBe(200)
    expect(service.restoreObject).toHaveBeenCalledWith(expect.anything(), 'o1')
  })
})

describe('GET /v1/storage/usage', () => {
  it('delega en service.getUsage', async () => {
    service.getUsage = vi.fn().mockResolvedValue({ bytesUsed: 10, quotaBytes: null })
    const res = await app.inject({ method: 'GET', url: '/v1/storage/usage' })
    expect(res.statusCode).toBe(200)
    expect(res.json().bytesUsed).toBe(10)
  })
})

describe('GET /v1/storage/objects (list)', () => {
  it('parsea filtros del query y delega', async () => {
    service.listObjects.mockResolvedValue([{ id: 'o1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/storage/objects?kind=menu_photo&limit=50' })
    expect(res.statusCode).toBe(200)
    expect(service.listObjects).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'menu_photo', limit: 50 }),
    )
  })
})
