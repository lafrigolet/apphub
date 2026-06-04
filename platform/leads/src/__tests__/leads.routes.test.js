import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/leads.service.js', () => ({
  create:    vi.fn(),
  listLeads: vi.fn(),
  getById:   vi.fn(),
  setStatus: vi.fn(),
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
        const role = token === 'staff-token' ? 'staff'
                  : token === 'super-token' ? 'super_admin'
                  : 'user'
        req.identity = { userId: 'u1', appId: 'platform', tenantId: 't1', role }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { publicRoutes, adminRoutes } from '../routes/leads.routes.js'
import * as service from '../services/leads.service.js'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  // Passthrough compiler que entiende zod schemas.
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
  await app.register(publicRoutes, { prefix: '/v1/leads' })
  await app.register(adminRoutes,  { prefix: '/v1/leads/admin' })
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
  contactName: 'Ana',
  email: 'ana@example.org',
  businessName: 'Tienda Ana',
  industry: 'shop',
  message: 'Quiero info',
  source: 'landing/contacto',
}

describe('POST /v1/leads — público', () => {
  it('201 + crea el lead sin Authorization (public route)', async () => {
    service.create.mockResolvedValue({ id: 'l1', created_at: new Date().toISOString(), status: 'new' })
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/',
      headers: { 'Content-Type': 'application/json' },
      payload: validBody,
    })
    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json.data.status).toBe('new')
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      contactName: 'Ana', email: 'ana@example.org',
    }))
  })

  it('inyecta ip + user-agent del request (anti-spam observability)', async () => {
    service.create.mockResolvedValue({ id: 'l1', created_at: '', status: 'new' })
    await app.inject({
      method: 'POST', url: '/v1/leads/',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'curl/8' },
      payload: validBody,
    })
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      ip: expect.any(String),
      userAgent: 'curl/8',
    }))
  })

  it('rechaza body inválido (zod schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/',
      headers: { 'Content-Type': 'application/json' },
      payload: { contactName: '', email: 'not-an-email' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.create).not.toHaveBeenCalled()
  })
})

describe('POST /v1/leads — honeypot anti-bot', () => {
  it('website relleno → 201 fake, NO persiste ni publica', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/',
      headers: { 'Content-Type': 'application/json' },
      payload: { ...validBody, website: 'http://spam.example' },
    })
    expect(res.statusCode).toBe(201)
    // Respuesta indistinguible de un alta real: trae id + status.
    expect(res.json().data.id).toBeTruthy()
    expect(res.json().data.status).toBe('new')
    expect(service.create).not.toHaveBeenCalled()
  })

  it('website vacío (string) → flujo normal, sí persiste', async () => {
    service.create.mockResolvedValue({ id: 'l1', created_at: '', status: 'new' })
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/',
      headers: { 'Content-Type': 'application/json' },
      payload: { ...validBody, website: '' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.create).toHaveBeenCalledTimes(1)
    // El campo honeypot nunca llega al servicio.
    expect(service.create.mock.calls[0][0]).not.toHaveProperty('website')
  })
})

describe('GET /v1/leads/admin — role-gated', () => {
  it('rechaza al user normal (403 por requireRole)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(service.listLeads).not.toHaveBeenCalled()
  })

  it('rechaza sin Bearer (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/' })
    expect(res.statusCode).toBe(401)
  })

  it('staff lista', async () => {
    service.listLeads.mockResolvedValue([{ id: 'l1' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'l1' }])
  })

  it('super_admin también lista', async () => {
    service.listLeads.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/',
      headers: { Authorization: 'Bearer super-token' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /v1/leads/admin/:id', () => {
  it('404 cuando el lead no existe', async () => {
    service.getById.mockResolvedValue(null)
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/abc',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('200 cuando existe', async () => {
    service.getById.mockResolvedValue({ id: 'l1', email: 'x@x' })
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('l1')
  })
})

describe('PATCH /v1/leads/admin/:id', () => {
  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { status: 'contacted' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('staff actualiza status + staffNotes', async () => {
    service.setStatus.mockResolvedValue({ id: 'l1', status: 'qualified', staff_notes: 'Pago hecho' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { status: 'qualified', staffNotes: 'Pago hecho' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.setStatus).toHaveBeenCalledWith('l1', 'qualified', 'Pago hecho')
  })

  it('404 si el lead no existe', async () => {
    service.setStatus.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/no',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { status: 'closed' },
    })
    expect(res.statusCode).toBe(404)
  })
})

// Ramas `?? {}` de los handlers: inalcanzables por HTTP (fastify valida el
// body-schema antes del handler), así que invocamos los handlers directamente.
describe('defaults defensivos (?? {}) — handlers directos', () => {
  async function publicHandlers() {
    const routes = []
    await publicRoutes({ post: (p, o, h) => routes.push({ m: 'post', p, h: h ?? o }) })
    return routes
  }
  async function adminHandlers() {
    const routes = []
    await adminRoutes({
      addHook: () => {},
      get:   (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
      patch: (p, o, h) => routes.push({ m: 'patch', p, h: h ?? o }),
    })
    return routes
  }

  it('POST / con req.body undefined → req.body ?? {} → la validación zod lanza', async () => {
    const [{ h }] = await publicHandlers()
    await expect(h({ headers: {}, ip: '1.1.1.1' }, { code: vi.fn() })).rejects.toBeTruthy()
  })

  it('GET / (admin) con req.query undefined → req.query ?? {} → listLeads con defaults', async () => {
    service.listLeads.mockResolvedValue([])
    const routes = await adminHandlers()
    const list = routes.find((r) => r.m === 'get' && r.p === '/')
    await list.h({})
    expect(service.listLeads).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 }))
  })

  it('PATCH /:id con req.body undefined → updateBody ?? {} → la validación zod lanza', async () => {
    const routes = await adminHandlers()
    const patch = routes.find((r) => r.m === 'patch')
    await expect(patch.h({ params: { id: 'l1' } }, { code: vi.fn() })).rejects.toBeTruthy()
  })
})
