import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/leads.service.js', () => ({
  create:         vi.fn(),
  listLeads:      vi.fn(),
  getById:        vi.fn(),
  update:         vi.fn(),
  convert:        vi.fn(),
  removeLead:     vi.fn(),
  addActivity:    vi.fn(),
  listActivities: vi.fn(),
}))

vi.mock('../services/analytics.service.js', () => ({
  funnel:      vi.fn(),
  byDimension: vi.fn(),
  byOwner:     vi.fn(),
  timeseries:  vi.fn(),
  exportCsv:   vi.fn(),
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
import * as analytics from '../services/analytics.service.js'

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

  it('staff actualiza status + staffNotes (vía service.update con actor)', async () => {
    service.update.mockResolvedValue({ id: 'l1', status: 'qualified', staff_notes: 'Pago hecho' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { status: 'qualified', staffNotes: 'Pago hecho' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.update).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ status: 'qualified', staffNotes: 'Pago hecho' }),
      expect.objectContaining({ userId: 'u1' }),
    )
  })

  it('asignación + score + tags + follow-up', async () => {
    service.update.mockResolvedValue({ id: 'l1' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: {
        assignedTo: '11111111-1111-1111-1111-111111111111',
        score: 80, tags: ['vip'], nextFollowUpAt: '2026-06-10T10:00:00Z',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(service.update.mock.calls[0][1]).toMatchObject({
      assignedTo: '11111111-1111-1111-1111-111111111111', score: 80, tags: ['vip'],
    })
  })

  it("status 'lost' sin lostReason → rechazado por zod", async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { status: 'lost' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.update).not.toHaveBeenCalled()
  })

  it("status 'lost' con lostReason → OK", async () => {
    service.update.mockResolvedValue({ id: 'l1', status: 'lost' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { status: 'lost', lostReason: 'presupuesto' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('404 si el lead no existe', async () => {
    service.update.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PATCH', url: '/v1/leads/admin/no',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { status: 'closed' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('actividades — timeline', () => {
  it('GET /:id/activities lista el timeline', async () => {
    service.listActivities.mockResolvedValue([{ id: 'a1', type: 'note' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/l1/activities',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'a1', type: 'note' }])
  })

  it('GET /:id/activities → 404 si el lead no existe', async () => {
    service.listActivities.mockResolvedValue(null)
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/no/activities',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /:id/activities crea nota con actor', async () => {
    service.addActivity.mockResolvedValue({ id: 'a1', type: 'note' })
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/admin/l1/activities',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { type: 'note', body: 'Llamada hecha' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addActivity).toHaveBeenCalledWith(
      'l1',
      { type: 'note', body: 'Llamada hecha' },
      expect.objectContaining({ userId: 'u1' }),
    )
  })

  it('POST /:id/activities rechaza type inválido', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/admin/l1/activities',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { type: 'status_change', body: 'manual' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.addActivity).not.toHaveBeenCalled()
  })
})

describe('POST /:id/convert — conversión lead → tenant', () => {
  const tenantId = '22222222-2222-2222-2222-222222222222'

  it('convierte y devuelve el lead won', async () => {
    service.convert.mockResolvedValue({ lead: { id: 'l1', status: 'won', converted_tenant_id: tenantId } })
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/admin/l1/convert',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { tenantId },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('won')
  })

  it('ya convertido → 409 ALREADY_CONVERTED', async () => {
    service.convert.mockResolvedValue({ conflict: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/admin/l1/convert',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { tenantId },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ALREADY_CONVERTED')
  })

  it('inexistente → 404', async () => {
    service.convert.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/v1/leads/admin/no/convert',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { tenantId },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /:id — GDPR', () => {
  it('204 al borrar', async () => {
    service.removeLead.mockResolvedValue({ id: 'l1' })
    const res = await app.inject({
      method: 'DELETE', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(204)
  })

  it('404 si no existe', async () => {
    service.removeLead.mockResolvedValue(null)
    const res = await app.inject({
      method: 'DELETE', url: '/v1/leads/admin/no',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/v1/leads/admin/l1',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe("GET / con assignedTo 'me' → traduce al userId del staff", () => {
  it('me → u1', async () => {
    service.listLeads.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/?assignedTo=me',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.listLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'u1' }))
  })
})

describe('analítica — role-gated + delegación', () => {
  it('user normal → 403 en funnel', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/analytics/funnel',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(analytics.funnel).not.toHaveBeenCalled()
  })

  it('staff obtiene el funnel', async () => {
    analytics.funnel.mockResolvedValue({ statusCounts: [{ status: 'new', count: 3 }], milestones: [] })
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/analytics/funnel',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.statusCounts[0].count).toBe(3)
  })

  it('by-dimension extrae dimension del query y pasa el rango', async () => {
    analytics.byDimension.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/analytics/by-dimension?dimension=utm_campaign',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(analytics.byDimension).toHaveBeenCalledWith('utm_campaign', expect.any(Object))
  })

  it('by-dimension rechaza una dimensión no permitida', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/analytics/by-dimension?dimension=email',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(analytics.byDimension).not.toHaveBeenCalled()
  })

  it('timeseries pasa la granularidad', async () => {
    analytics.timeseries.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/analytics/timeseries?granularity=month',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(analytics.timeseries).toHaveBeenCalledWith('month', expect.any(Object))
  })

  it('export.csv devuelve text/csv y traduce assignedTo=me', async () => {
    analytics.exportCsv.mockResolvedValue('id,email\nl1,a@b.com')
    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/analytics/export.csv?assignedTo=me',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('leads-export.csv')
    expect(analytics.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'u1' }))
    expect(res.body).toContain('l1,a@b.com')
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
      get:    (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
      patch:  (p, o, h) => routes.push({ m: 'patch', p, h: h ?? o }),
      post:   (p, o, h) => routes.push({ m: 'post', p, h: h ?? o }),
      delete: (p, o, h) => routes.push({ m: 'delete', p, h: h ?? o }),
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

  it('PATCH /:id con req.body undefined → {} es un patch vacío válido (no-op)', async () => {
    service.update.mockResolvedValue({ id: 'l1' })
    const routes = await adminHandlers()
    const patch = routes.find((r) => r.m === 'patch' && r.p === '/:id')
    await patch.h({ params: { id: 'l1' } }, { code: vi.fn() })
    expect(service.update).toHaveBeenCalledWith('l1', {}, expect.anything())
  })
})
