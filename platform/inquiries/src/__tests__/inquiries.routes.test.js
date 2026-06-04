// inquiries.routes — wiring HTTP → service.
// Contrato:
//   publicRoutes:
//     - POST / es `public` (sin Bearer) → 201 { data:{ reference, id, createdAt } }.
//     - Inyecta ip + user-agent del request en service.create.
//     - body inválido (zod) no llega al service.
//   adminRoutes (preHandler requireRole owner|admin|staff|super_admin):
//     - sin Bearer → 401; role 'user' → 403.
//     - GET /settings, PUT /settings, GET /, GET /:id, PATCH /:id delegan
//       en el service con req.identity.
//     - '/settings' se resuelve ANTES que '/:id' (no choca con el matcher).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/inquiries.service.js', () => ({
  create:    vi.fn(),
  listAdmin: vi.fn(),
  getById:   vi.fn(),
  update:    vi.fn(),
}))

vi.mock('../services/settings.service.js', () => ({
  getForTenant:    vi.fn(),
  upsertForTenant: vi.fn(),
}))

// app-guard stub con fastify-plugin para encapsulación correcta.
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
        const role = token === 'admin-token' ? 'admin'
                  : token === 'staff-token' ? 'staff'
                  : token === 'super-token' ? 'super_admin'
                  : 'user'
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { publicRoutes, adminRoutes } from '../routes/inquiries.routes.js'
import * as service from '../services/inquiries.service.js'
import * as settingsService from '../services/settings.service.js'

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
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(async (scope) => { await publicRoutes(scope, { redis: { publish: vi.fn() } }) }, { prefix: '/v1/inquiries' })
  await app.register(adminRoutes, { prefix: '/v1/inquiries/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const validBody = {
  appId:       'aikikan',
  tenantId:    '22222222-2222-2222-2222-222222222222',
  contactName: 'Ana',
  email:       'ana@example.org',
  message:     'Hola, quiero info',
  source:      'landing/contacto',
}

describe('POST /v1/inquiries — público', () => {
  it('201 sin Authorization (ruta public), responde { reference, id, createdAt }', async () => {
    service.create.mockResolvedValue({ id: 'iq1', reference: 'AB12CD', created_at: '2026-01-01T00:00:00Z' })
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      headers: { 'Content-Type': 'application/json' },
      payload: validBody,
    })
    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json.data).toEqual({ reference: 'AB12CD', id: 'iq1', createdAt: '2026-01-01T00:00:00Z' })
  })

  it('inyecta ip + user-agent en service.create', async () => {
    service.create.mockResolvedValue({ id: 'iq1', reference: 'R', created_at: '' })
    await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'curl/8' },
      payload: validBody,
    })
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ redis: expect.objectContaining({ publish: expect.any(Function) }) }),
      expect.objectContaining({ email: 'ana@example.org', ip: expect.any(String), userAgent: 'curl/8' }),
    )
  })

  it('body inválido (email malo, message vacío) no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      headers: { 'Content-Type': 'application/json' },
      payload: { appId: 'aikikan', tenantId: 'not-a-uuid', contactName: '', email: 'nope', message: '' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.create).not.toHaveBeenCalled()
  })
})

describe('POST /v1/inquiries — honeypot anti-bot', () => {
  it('website relleno → 201 fake, NO persiste', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      headers: { 'Content-Type': 'application/json' },
      payload: { ...validBody, website: 'http://spam.example' },
    })
    expect(res.statusCode).toBe(201)
    // Respuesta indistinguible de un alta real: reference + id + createdAt.
    expect(res.json().data.reference).toBeTruthy()
    expect(res.json().data.id).toBeTruthy()
    expect(res.json().data.createdAt).toBeTruthy()
    expect(service.create).not.toHaveBeenCalled()
  })

  it('website vacío (string) → flujo normal, sí persiste', async () => {
    service.create.mockResolvedValue({ id: 'iq1', reference: 'R', created_at: '' })
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      headers: { 'Content-Type': 'application/json' },
      payload: { ...validBody, website: '' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.create).toHaveBeenCalledTimes(1)
    // El campo honeypot nunca llega al servicio.
    expect(service.create.mock.calls[0][1]).not.toHaveProperty('website')
  })
})

describe('admin — role gating', () => {
  it('GET /admin sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/' })
    expect(res.statusCode).toBe(401)
    expect(service.listAdmin).not.toHaveBeenCalled()
  })

  it('GET /admin con role user → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/inquiries/admin/',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(service.listAdmin).not.toHaveBeenCalled()
  })
})

describe('admin — delegación al service con req.identity', () => {
  const auth = { authorization: 'Bearer admin-token' }

  it('GET /admin/ → service.listAdmin(identity, query)', async () => {
    service.listAdmin.mockResolvedValue([{ id: 'iq1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/?status=new&limit=10', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'iq1' }])
    const [identity, q] = service.listAdmin.mock.calls[0]
    expect(identity).toMatchObject({ role: 'admin', tenantId: 't1' })
    expect(q).toMatchObject({ status: 'new', limit: 10 })
  })

  it('GET /admin/:id → service.getById(identity, id)', async () => {
    service.getById.mockResolvedValue({ id: 'iq9' })
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/iq9', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getById).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), 'iq9')
  })

  it('PATCH /admin/:id → service.update(identity, id, body)', async () => {
    service.update.mockResolvedValue({ id: 'iq9', status: 'contacted' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/inquiries/admin/iq9', headers: { ...auth, 'Content-Type': 'application/json' },
      payload: { status: 'contacted', staffNotes: 'llamado' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }), 'iq9',
      expect.objectContaining({ status: 'contacted', staffNotes: 'llamado' }),
    )
  })

  it('GET /admin/settings → settingsService.getForTenant (no choca con /:id)', async () => {
    settingsService.getForTenant.mockResolvedValue({ contact_inbox_email: 'box@x.com' })
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/settings', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.contact_inbox_email).toBe('box@x.com')
    expect(settingsService.getForTenant).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }))
    expect(service.getById).not.toHaveBeenCalled()
  })

  it('PUT /admin/settings → settingsService.upsertForTenant(identity, body)', async () => {
    settingsService.upsertForTenant.mockResolvedValue({ contact_inbox_email: 'box@x.com' })
    const res = await app.inject({
      method: 'PUT', url: '/v1/inquiries/admin/settings', headers: { ...auth, 'Content-Type': 'application/json' },
      payload: { contactInboxEmail: 'box@x.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(settingsService.upsertForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      expect.objectContaining({ contactInboxEmail: 'box@x.com' }),
    )
  })

  it('PUT /admin/settings con email inválido no llega al service', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/inquiries/admin/settings', headers: { ...auth, 'Content-Type': 'application/json' },
      payload: { contactInboxEmail: 'not-an-email' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(settingsService.upsertForTenant).not.toHaveBeenCalled()
  })
})

// Las ramas `?? {}` de los handlers son inalcanzables por HTTP (fastify valida
// el body-schema antes del handler), así que invocamos los handlers
// directamente con body/query undefined.
describe('defaults defensivos (?? {}) — invocación directa de handlers', () => {
  const identity = { userId: 'a', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'admin' }

  async function publicHandlers() {
    const routes = []
    // sin opts → cubre `opts ?? {}`
    await publicRoutes({ post: (p, o, h) => routes.push({ p, h: h ?? o }) })
    return routes
  }
  async function adminHandlers() {
    const routes = []
    await adminRoutes({
      addHook: () => {},
      get:   (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
      put:   (p, o, h) => routes.push({ m: 'put', p, h: h ?? o }),
      patch: (p, o, h) => routes.push({ m: 'patch', p, h: h ?? o }),
    })
    return routes
  }

  it('POST / handler con req.body undefined → req.body ?? {} → la validación zod lanza', async () => {
    const [{ h }] = await publicHandlers()
    await expect(h({ headers: {}, ip: '1.1.1.1' }, { code: vi.fn() })).rejects.toBeTruthy()
  })

  it('GET /admin/ handler con req.query undefined → req.query ?? {} → listAdmin con defaults', async () => {
    service.listAdmin.mockResolvedValue([])
    const routes = await adminHandlers()
    const list = routes.find((r) => r.m === 'get' && r.p === '/')
    await list.h({ identity })
    expect(service.listAdmin).toHaveBeenCalledWith(identity, expect.objectContaining({ limit: 100, offset: 0 }))
  })

  it('PATCH /admin/:id handler con req.body undefined → updateBody ?? {} (válido) → service.update con {}', async () => {
    service.update.mockResolvedValue({ id: 'x' })
    const routes = await adminHandlers()
    const patch = routes.find((r) => r.m === 'patch')
    await patch.h({ identity, params: { id: 'x' } })
    expect(service.update).toHaveBeenCalledWith(identity, 'x', {})
  })

  it('PUT /admin/settings handler con req.body undefined → settingsBody ?? {} → la validación zod lanza', async () => {
    const routes = await adminHandlers()
    const put = routes.find((r) => r.m === 'put' && r.p === '/settings')
    await expect(put.h({ identity })).rejects.toBeTruthy()
  })
})
