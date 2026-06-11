// checkout.routes wiring: Checkout Session creation (QR / payment link) + status
// poll, tenant scoping and auth. Services are mocked (Stripe is exercised in the
// service's own path, not here).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/checkout.service.js', () => ({
  createCheckoutSession: vi.fn(),
}))

vi.mock('../services/payment.service.js', () => ({
  getIntent: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({
  getPayLink: vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        req.identity = { userId: 'u1', appId: 'tpv', tenantId: 't1', subTenantId: null, role: 'user' }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { checkoutRoutes } from '../routes/checkout.routes.js'
import * as checkout from '../services/checkout.service.js'
import * as payments from '../services/payment.service.js'
import { getPayLink } from '../lib/redis.js'
import { AppError } from '@apphub/platform-sdk/errors'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'

async function buildApp() {
  const app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  app.decorateRequest('tenant', null)
  app.addHook('preHandler', async (req) => {
    if (!req.identity) return
    req.tenant = { appId: req.identity.appId, tenantId: req.identity.tenantId, subTenantId: null, userId: req.identity.userId }
  })
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.register(checkoutRoutes, { prefix: '/v1/payments' })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/payments/checkout-sessions', () => {
  it('201 with url + qr, scoped to req.tenant', async () => {
    checkout.createCheckoutSession.mockResolvedValue({
      transactionId: 'tx1', sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1',
      qr: 'data:image/png;base64,xxx', status: 'pending', stub: false,
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout-sessions',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { amountCents: 1234, description: 'Mesa 4' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.url).toBe('https://checkout.stripe.com/c/pay/cs_1')
    expect(res.json().data.sessionId).toBe('cs_1')
    expect(checkout.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'tpv', tenantId: 't1' }),
      expect.objectContaining({ amountCents: 1234, currency: 'eur', expiresInMinutes: 30 }),
      expect.objectContaining({ publicBase: null }), // unset PAYMENTS_PUBLIC_BASE_URL
    )
  })

  it('401 without Bearer', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout-sessions',
      headers: { 'Content-Type': 'application/json' }, payload: { amountCents: 1234 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('422 on missing amountCents', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout-sessions',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(422)
    expect(checkout.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('422 on non-positive amount', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/checkout-sessions',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { amountCents: 0 },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /v1/payments/checkout-sessions/:id', () => {
  it('returns the transaction (status poll)', async () => {
    payments.getIntent.mockResolvedValue({ id: 'tx1', status: 'succeeded', amountCents: 1234 })
    const res = await app.inject({
      method: 'GET', url: '/v1/payments/checkout-sessions/11111111-1111-1111-1111-111111111111',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('succeeded')
    expect(payments.getIntent).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'tpv', tenantId: 't1' }),
      '11111111-1111-1111-1111-111111111111',
    )
  })
})

describe('GET /v1/payments/pay/:code (public redirect)', () => {
  it('302 to the resolved checkout URL (no auth required)', async () => {
    getPayLink.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test_X')
    const res = await app.inject({ method: 'GET', url: '/v1/payments/pay/abc123' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://checkout.stripe.com/c/pay/cs_test_X')
    expect(getPayLink).toHaveBeenCalledWith('abc123')
  })

  it('404 for an unknown/expired code', async () => {
    getPayLink.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/v1/payments/pay/nope' })
    expect(res.statusCode).toBe(404)
  })
})
