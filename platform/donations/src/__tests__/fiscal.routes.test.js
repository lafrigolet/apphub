import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/certificate.service.js', () => ({
  listCertificates:            vi.fn(),
  generateAnnualCertificates:  vi.fn(),
}))
vi.mock('../services/modelo182.service.js', () => ({
  exportModelo182: vi.fn(),
}))
vi.mock('../services/deduction.service.js', () => ({
  estimateDeduction: vi.fn(),
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

import { adminFiscalRoutes } from '../routes/fiscal.routes.js'
import * as certService from '../services/certificate.service.js'
import * as modelo182Service from '../services/modelo182.service.js'
import * as deductionService from '../services/deduction.service.js'

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
  await app.register(adminFiscalRoutes, { prefix: '/v1/donations/admin/fiscal' })
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

describe('role gating', () => {
  it('401 sin Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/admin/fiscal/certificates' })
    expect(res.statusCode).toBe(401)
  })
  it('403 al user normal', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/certificates',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /certificates', () => {
  it('sin year → year undefined', async () => {
    certService.listCertificates.mockResolvedValue([{ id: 'c1' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/certificates',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: 'c1' }] })
    expect(certService.listCertificates).toHaveBeenCalledWith(expect.any(Object), { year: undefined })
  })
  it('con year → lo pasa numérico', async () => {
    certService.listCertificates.mockResolvedValue([])
    await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/certificates?year=2025',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(certService.listCertificates).toHaveBeenCalledWith(expect.any(Object), { year: 2025 })
  })
})

describe('POST /certificates/generate', () => {
  it('genera certificados con body validado', async () => {
    certService.generateAnnualCertificates.mockResolvedValue({ generated: 3 })
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/admin/fiscal/certificates/generate',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { year: 2025 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { generated: 3 } })
    expect(certService.generateAnnualCertificates).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ year: 2025 }),
      expect.objectContaining({ redis: null }),
    )
  })
  it('body inválido (year fuera de rango) → 4xx/500', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/admin/fiscal/certificates/generate',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { year: 1990 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(certService.generateAnnualCertificates).not.toHaveBeenCalled()
  })
})

describe('GET /modelo-182', () => {
  it('emite TXT con headers AEAT (iso-8859-1, filename, counts)', async () => {
    modelo182Service.exportModelo182.mockResolvedValue({
      filename: 'modelo182-2025.txt',
      buffer: Buffer.from('LINE'),
      year: 2025, count: 4, totalCents: 12000,
    })
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/modelo-182?year=2025',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/iso-8859-1/)
    expect(res.headers['content-disposition']).toMatch(/modelo182-2025\.txt/)
    expect(res.headers['x-donors-count']).toBe('4')
    expect(res.headers['x-donors-total-cents']).toBe('12000')
    expect(res.headers['x-fiscal-year']).toBe('2025')
    expect(res.body).toBe('LINE')
  })

  it('emite X-Donors-Skipped con el nº de donantes con NIF inválido', async () => {
    modelo182Service.exportModelo182.mockResolvedValue({
      filename: 'm.txt', buffer: Buffer.from('X'),
      year: 2025, count: 2, totalCents: 100,
      skipped: [{ donorNif: 'BAD', donorName: 'X', totalCents: 50 }],
    })
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/modelo-182?year=2025',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.headers['x-donors-skipped']).toBe('1')
  })
})

describe('GET /deduction', () => {
  it('403 al user normal', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/deduction?year=2025&donorNif=12345678Z',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
  it('delega a estimateDeduction y devuelve el cálculo', async () => {
    deductionService.estimateDeduction.mockResolvedValue({
      donorNif: '12345678Z', fiscalYear: 2025, deductibleCents: 20000,
    })
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/fiscal/deduction?year=2025&donorNif=12345678Z',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { donorNif: '12345678Z', fiscalYear: 2025, deductibleCents: 20000 } })
    expect(deductionService.estimateDeduction).toHaveBeenCalledWith(
      expect.any(Object), expect.objectContaining({ year: 2025, donorNif: '12345678Z' }),
    )
  })
})

// Ramas `?? {}`: fastify valida el schema antes del handler. Invocamos los
// handlers directamente con req.body/query undefined para cubrirlas.
describe('defaults defensivos (?? {}) — handlers directos', () => {
  async function fiscalHandlers() {
    const routes = []
    await adminFiscalRoutes({
      addHook: () => {},
      get:  (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
      post: (p, o, h) => routes.push({ m: 'post', p, h: h ?? o }),
    })
    return routes
  }

  it('POST /certificates/generate con req.body undefined → generateBody.parse({}) lanza (year requerido)', async () => {
    const routes = await fiscalHandlers()
    const gen = routes.find((r) => r.m === 'post' && r.p === '/certificates/generate')
    await expect(gen.h({})).rejects.toBeTruthy()
  })

  it('GET /modelo-182 con req.query undefined → modelo182Query.parse({}) lanza (year requerido)', async () => {
    const routes = await fiscalHandlers()
    const m182 = routes.find((r) => r.m === 'get' && r.p === '/modelo-182')
    await expect(m182.h({}, { header: vi.fn(), send: vi.fn() })).rejects.toBeTruthy()
  })
})
