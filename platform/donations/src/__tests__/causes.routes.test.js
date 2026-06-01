import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/causes.service.js', () => ({
  listPublicCauses: vi.fn(),
  listAllCauses:    vi.fn(),
  getCauseById:     vi.fn(),
  createCause:      vi.fn(),
  updateCause:      vi.fn(),
  deleteCause:      vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        const token = auth.slice(7)
        const role = token === 'admin-token' ? 'admin' : (token === 'staff-token' ? 'staff' : 'user')
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { publicCausesRoutes, adminCausesRoutes } from '../routes/causes.routes.js'
import * as service from '../services/causes.service.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: new Error('VALIDATION') }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (data) => JSON.stringify(data))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(publicCausesRoutes, { prefix: '/v1/donations/causes' })
  await app.register(adminCausesRoutes,  { prefix: '/v1/donations/admin/causes' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'ERROR', message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const TENANT = '30000000-0000-0000-0000-000000000001'

describe('GET /v1/donations/causes — público', () => {
  it('200 sin Bearer; delega a listPublicCauses con appId/tenantId del query', async () => {
    service.listPublicCauses.mockResolvedValue([{ id: 'cz1' }])
    const res = await app.inject({
      method: 'GET', url: `/v1/donations/causes?appId=aikikan&tenantId=${TENANT}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: 'cz1' }] })
    expect(service.listPublicCauses).toHaveBeenCalledWith({ appId: 'aikikan', tenantId: TENANT })
  })

  it('query inválido → 4xx/500', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/causes?appId=aikikan' })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.listPublicCauses).not.toHaveBeenCalled()
  })
})

describe('GET /v1/donations/admin/causes — role-gated', () => {
  it('401 sin Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/admin/causes/' })
    expect(res.statusCode).toBe(401)
  })
  it('403 al user normal', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/causes/',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
  it('admin lista todas (incl. inactivas)', async () => {
    service.listAllCauses.mockResolvedValue([{ id: 'cz1' }, { id: 'cz2' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/causes/',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(2)
    expect(service.listAllCauses).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }))
  })
})

describe('GET /v1/donations/admin/causes/:id', () => {
  it('delega a getCauseById con identity + id', async () => {
    service.getCauseById.mockResolvedValue({ id: 'cz1' })
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/causes/cz1',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.getCauseById).toHaveBeenCalledWith(expect.any(Object), 'cz1')
  })
})

describe('POST /v1/donations/admin/causes', () => {
  it('201 + createCause con body', async () => {
    service.createCause.mockResolvedValue({ id: 'cz1', code: 'C' })
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/admin/causes/',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { code: 'C', name: 'Cause' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createCause).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ code: 'C', name: 'Cause' }),
    )
  })
  it('body inválido → 4xx/500', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/admin/causes/',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { name: '' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createCause).not.toHaveBeenCalled()
  })
})

describe('PATCH /v1/donations/admin/causes/:id', () => {
  it('delega a updateCause', async () => {
    service.updateCause.mockResolvedValue({ id: 'cz1', name: 'New' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/donations/admin/causes/cz1',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { name: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateCause).toHaveBeenCalledWith(expect.any(Object), 'cz1', expect.objectContaining({ name: 'New' }))
  })
})

describe('DELETE /v1/donations/admin/causes/:id', () => {
  it('204 + deleteCause (soft)', async () => {
    service.deleteCause.mockResolvedValue()
    const res = await app.inject({
      method: 'DELETE', url: '/v1/donations/admin/causes/cz1',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(204)
    expect(service.deleteCause).toHaveBeenCalledWith(expect.any(Object), 'cz1')
  })
})

// Ramas `?? {}` de los handlers: fastify valida el schema antes del handler,
// así que invocamos los handlers directamente con req.query/body undefined.
describe('defaults defensivos (?? {}) — handlers directos', () => {
  async function publicHandlers() {
    const routes = []
    await publicCausesRoutes({ get: (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }) })
    return routes
  }
  async function adminHandlers() {
    const routes = []
    await adminCausesRoutes({
      addHook: () => {},
      get:    (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
      post:   (p, o, h) => routes.push({ m: 'post', p, h: h ?? o }),
      patch:  (p, o, h) => routes.push({ m: 'patch', p, h: h ?? o }),
      delete: (p, o, h) => routes.push({ m: 'delete', p, h: h ?? o }),
    })
    return routes
  }

  it('GET / público con req.query undefined → publicListQuery.parse({}) lanza (campos requeridos)', async () => {
    const [{ h }] = await publicHandlers()
    await expect(h({})).rejects.toBeTruthy()
  })

  it('POST / admin con req.body undefined → createBody.parse({}) lanza (code/name requeridos)', async () => {
    const routes = await adminHandlers()
    const post = routes.find((r) => r.m === 'post')
    await expect(post.h({}, { code: vi.fn() })).rejects.toBeTruthy()
  })

  it('PATCH /:id admin con req.body undefined → updateBody.parse({}) (todo opcional) → updateCause', async () => {
    service.updateCause.mockResolvedValue({ id: 'cz1' })
    const routes = await adminHandlers()
    const patch = routes.find((r) => r.m === 'patch')
    await patch.h({ params: { id: 'cz1' } })
    expect(service.updateCause).toHaveBeenCalledWith(undefined, 'cz1', {})
  })
})
