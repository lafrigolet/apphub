import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/receipts.service.js', () => ({
  issueReceipt:   vi.fn(),
  listReceipts:   vi.fn(),
  getReceipt:     vi.fn(),
  convertReceipt: vi.fn(),
  resendReceipt:  vi.fn(),
}))

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn({ query: vi.fn() })),
  withStaffBypass: vi.fn(),
  pool: {},
  configurePool: vi.fn(),
}))

vi.mock('../repositories/settings.repository.js', () => ({
  getOrDefaults: vi.fn(async () => ({ receipt_footer: 'Gracias por su visita' })),
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
        const role = auth.slice(7) === 'cashier-token' ? 'cashier' : 'user'
        req.identity = {
          userId: 'u1', appId: 'aikikan',
          tenantId: '30000000-0000-0000-0000-000000000001',
          subTenantId: null, role, email: 'x@x',
        }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { receiptsRoutes } from '../routes/receipts.routes.js'
import * as service from '../services/receipts.service.js'

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
  app.setSerializerCompiler(() => (data) => (typeof data === 'string' ? data : JSON.stringify(data)))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(receiptsRoutes, { prefix: '/v1/tpv/receipts' })
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

const FACT = '60000000-0000-0000-0000-000000000001'
const RECEIPT = '70000000-0000-0000-0000-000000000001'

describe('POST /v1/tpv/receipts — emisión', () => {
  it('emite simplificado desde un fact (201)', async () => {
    service.issueReceipt.mockResolvedValue({ id: RECEIPT, num_serie: 'A-000001', type: 'simplified' })
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/receipts',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { billingFactId: FACT },
    })
    expect(res.statusCode).toBe(201)
    expect(service.issueReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ billingFactId: FACT, type: 'simplified' }),
    )
  })

  it('una factura completa exige receptor en el service (el contrato pasa receptor)', async () => {
    service.issueReceipt.mockResolvedValue({ id: RECEIPT, type: 'invoice' })
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/receipts',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { billingFactId: FACT, type: 'invoice', receptor: { nif: 'B12345678', name: 'ACME SL' } },
    })
    expect(res.statusCode).toBe(201)
    expect(service.issueReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ receptor: expect.objectContaining({ nif: 'B12345678' }) }),
    )
  })

  it('422 sin billingFactId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/receipts',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { type: 'simplified' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.issueReceipt).not.toHaveBeenCalled()
  })

  it('403 para rol user', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/receipts',
      headers: { Authorization: 'Bearer other' },
      payload: { billingFactId: FACT },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/tpv/receipts/:id/render — HTML desde snapshot', () => {
  it('devuelve text/html con num_serie y total', async () => {
    service.getReceipt.mockResolvedValue({
      id: RECEIPT, num_serie: 'A-000001', type: 'simplified', status: 'issued',
      currency: 'EUR', subtotal_cents: 4500, tax_cents: 450, total_cents: 4950,
      tax_breakdown: [{ rate: 10, baseCents: 4500, quotaCents: 450 }],
      issuer: { nif: 'B11111111', name: 'Dojo SL' },
      verifactu_status: 'pending', qr_data_uri: null, issued_at: '2026-06-05T10:00:00Z',
      lines: [{ sku: 'KGI-1', name: 'Keikogi', qty: 1, line_base_cents: 4500, line_tax_cents: 450 }],
    })
    const res = await app.inject({
      method: 'GET', url: `/v1/tpv/receipts/${RECEIPT}/render`,
      headers: { Authorization: 'Bearer cashier-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('A-000001')
    expect(res.body).toContain('49.50')
    expect(res.body).toContain('Gracias por su visita')
  })
})

describe('POST /v1/tpv/receipts/:id/convert — canje a factura', () => {
  it('exige receptor (422 sin él)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/receipts/${RECEIPT}/convert`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: {},
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.convertReceipt).not.toHaveBeenCalled()
  })

  it('201 con receptor válido', async () => {
    service.convertReceipt.mockResolvedValue({ id: 'r2', type: 'invoice', num_serie: 'B-000001' })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/receipts/${RECEIPT}/convert`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { receptor: { nif: '12345678Z', name: 'Cliente X' } },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('POST /v1/tpv/receipts/:id/resend — reenvío idempotente', () => {
  it('202 y delega en el service', async () => {
    service.resendReceipt.mockResolvedValue({ queued: true })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/receipts/${RECEIPT}/resend`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { email: 'cliente@x.es' },
    })
    expect(res.statusCode).toBe(202)
    expect(service.resendReceipt).toHaveBeenCalledWith(expect.anything(), RECEIPT, { email: 'cliente@x.es' })
  })
})
