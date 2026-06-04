// payment.routes + webhook.routes wiring: schema validation, tenant scoping,
// the staff-only refund gate, and the webhook signature path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/payment.service.js', () => ({
  createPaymentIntent: vi.fn(),
  listIntents: vi.fn(),
  getIntent: vi.fn(),
  cancelIntent: vi.fn(),
  captureIntent: vi.fn(),
  createRefund: vi.fn(),
  listRefunds: vi.fn(),
}))

const webhookMock = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/webhook.service.js', () => webhookMock)

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        const token = auth.slice(7)
        const role = token === 'staff-token' ? 'staff' : token === 'super-token' ? 'super_admin' : 'user'
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

import { paymentRoutes } from '../routes/payment.routes.js'
import { webhookRoutes } from '../routes/webhook.routes.js'
import * as service from '../services/payment.service.js'
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
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.routeOptions.config?.rawBody) { req.rawBody = body; try { done(null, body.length ? JSON.parse(body.toString()) : {}) } catch { done(null, {}) } }
    else { try { done(null, body.length ? JSON.parse(body.toString()) : {}) } catch (err) { done(err) } }
  })
  // Error handler must be set before registering the route plugins so it applies
  // to their encapsulated contexts (mirrors production index.js ordering).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.register(paymentRoutes, { prefix: '/v1/payments' })
  await app.register(webhookRoutes, { prefix: '/v1/payments/webhooks' })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); webhookMock.handleWebhookEvent.mockResolvedValue(undefined); app = await buildApp() })
afterEach(async () => { await app.close() })

const UUID = '11111111-1111-1111-1111-111111111111'

describe('POST /v1/payments/intents', () => {
  it('201 with the created intent, scoped to req.tenant', async () => {
    service.createPaymentIntent.mockResolvedValue({ transactionId: UUID })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/intents',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { amount: 5000, currency: 'eur', userId: UUID, idempotencyKey: 'k1' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1' }),
      expect.objectContaining({ amount: 5000, idempotencyKey: 'k1' }),
    )
  })

  it('401 without Bearer', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/payments/intents', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('422 on invalid body (missing idempotencyKey)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/intents',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { amount: 5000, userId: UUID },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /v1/payments/intents/:id', () => {
  it('returns the transaction', async () => {
    service.getIntent.mockResolvedValue({ id: UUID, status: 'succeeded' })
    const res = await app.inject({ method: 'GET', url: `/v1/payments/intents/${UUID}`, headers: { Authorization: 'Bearer user-token' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('succeeded')
  })
})

describe('refund role gate', () => {
  it('403 for a normal user', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/payments/transactions/${UUID}/refunds`,
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { idempotencyKey: 'r1' },
    })
    expect(res.statusCode).toBe(403)
    expect(service.createRefund).not.toHaveBeenCalled()
  })

  it('201 for staff', async () => {
    service.createRefund.mockResolvedValue({ refundId: UUID })
    const res = await app.inject({
      method: 'POST', url: `/v1/payments/transactions/${UUID}/refunds`,
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { amount: 1000, idempotencyKey: 'r1' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createRefund).toHaveBeenCalled()
  })
})

describe('POST /v1/payments/webhooks/stripe', () => {
  it('400 without Stripe-Signature header', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/stripe',
      headers: { 'Content-Type': 'application/json' }, payload: { x: 1 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('MISSING_SIGNATURE')
  })

  it('400 on invalid signature', async () => {
    webhookMock.constructWebhookEvent.mockRejectedValue(new Error('bad sig'))
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' }, payload: { x: 1 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_SIGNATURE')
  })

  it('200 received:true on a valid signature, processes async', async () => {
    webhookMock.constructWebhookEvent.mockResolvedValue({ id: 'evt_1', type: 'payment_intent.succeeded' })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' }, payload: { x: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(webhookMock.handleWebhookEvent).toHaveBeenCalled()
  })
})
