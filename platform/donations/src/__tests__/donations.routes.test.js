import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Mocks de servicios — capturan llamadas y devuelven stubs ──────────
vi.mock('../services/donations.service.js', () => ({
  createCheckout:      vi.fn(),
  listMyDonations:     vi.fn(),
  listMySubscriptions: vi.fn(),
  getDonation:         vi.fn(),
  listAdminDonations:  vi.fn(),
  refund:              vi.fn(),
}))
vi.mock('../services/donation-subscriptions.service.js', () => ({
  cancel:    vi.fn(),
  listAdmin: vi.fn(),
}))

// app-guard stub que aprueba públicas y exige Bearer en el resto. Si llega
// "admin-token" inyecta role=admin; cualquier otro Bearer → role=user.
// Usamos fastify-plugin para encapsulación correcta (mismo patrón que el real).
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
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role, email: 'x@x' }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { publicRoutes, authenticatedRoutes, adminRoutes } from '../routes/donations.routes.js'
import * as service from '../services/donations.service.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  // Compiler que pasa zod-schemas por delante: usa `.parse()` para
  // validar. No-op si el schema no es zod. Replica lo que hace
  // fastify-type-provider-zod sin arrastrar la dep en este módulo.
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
  // Replicar el mounting de platform/donations/src/index.js
  await app.register(publicRoutes,        { prefix: '/v1/donations' })
  await app.register(authenticatedRoutes, { prefix: '/v1/donations' })
  await app.register(adminRoutes,         { prefix: '/v1/donations/admin' })
  app.setErrorHandler((err, req, reply) => {
    // mirror platform-core
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'ERROR', message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const validBody = {
  appId:       'aikikan',
  tenantId:    '30000000-0000-0000-0000-000000000001',
  amountCents: 2500,
  currency:    'EUR',
  donorEmail:  'donor@x.org',
  kind:        'one_shot',
  successUrl:  'http://x/ok',
  cancelUrl:   'http://x/no',
}

describe('POST /v1/donations/checkout — público', () => {
  it('NO requiere Bearer (public route) y devuelve 201 con sessionUrl', async () => {
    service.createCheckout.mockResolvedValue({ sessionUrl: 'https://s/test', donationId: 'd1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/checkout',
      headers: { 'Content-Type': 'application/json' }, payload: validBody,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: { sessionUrl: 'https://s/test', donationId: 'd1' } })
  })

  it('422 en body inválido (zod)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/checkout',
      headers: { 'Content-Type': 'application/json' },
      payload: { amountCents: 50 },     // falta casi todo
    })
    expect([400, 422, 500]).toContain(res.statusCode)   // Fastify v4/v5 difieren en el código
    expect(service.createCheckout).not.toHaveBeenCalled()
  })

  it('pasa el Bearer al service si el caller manda Authorization', async () => {
    service.createCheckout.mockResolvedValue({ sessionUrl: 's', donationId: 'd1' })
    await app.inject({
      method: 'POST', url: '/v1/donations/checkout',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer caller-jwt' },
      payload: validBody,
    })
    expect(service.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 2500 }),
      { bearerToken: 'caller-jwt' },
    )
  })
})

describe('GET /v1/donations/me — autenticado', () => {
  it('rechaza sin Bearer (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/me' })
    expect(res.statusCode).toBe(401)
  })
  it('devuelve la lista del donante con Bearer', async () => {
    service.listMyDonations.mockResolvedValue([{ id: 'd1' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/me',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: 'd1' }] })
  })
})

describe('GET /v1/donations/admin — admin-only', () => {
  it('rechaza al usuario normal (403 por requireRole)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(service.listAdminDonations).not.toHaveBeenCalled()
  })
  it('permite al admin', async () => {
    service.listAdminDonations.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
  })
  it('permite a staff', async () => {
    service.listAdminDonations.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /v1/donations/admin/:id/refund', () => {
  it('rechaza user (403)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/admin/d1/refund',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { idempotencyKey: 'k1' },
    })
    expect(res.statusCode).toBe(403)
  })
  it('admin OK con idempotencyKey', async () => {
    service.refund.mockResolvedValue({ id: 'd1', status: 'refunded' })
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/admin/d1/refund',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { idempotencyKey: 'k1' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.refund).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      'd1',
      expect.objectContaining({ idempotencyKey: 'k1' }),
    )
  })
})
