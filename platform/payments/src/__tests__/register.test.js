// register() — the platform-core entry point. Unlike app.js (standalone server),
// register() mounts the module inside a host Fastify app. This suite locks in
// that the encapsulated scope wires the zod validator/serializer compilers and
// the Stripe-aware error handler, so route schemas actually validate (a regress-
// ion: without setValidatorCompiler the zod schemas are inert and bad bodies pass
// straight through to the service).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// env.js calls process.exit(1) at import when DATABASE_URL/REDIS_URL are unset;
// migrate.js (re-exported by index.js) pulls it in. Stub both.
vi.mock('../lib/env.js', () => ({ env: { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' } }))
vi.mock('../lib/migrate.js', () => ({ runMigrations: vi.fn() }))

// Keep register() from touching real DB/Redis/Stripe at boot.
vi.mock('../lib/db.js', () => ({ configurePool: vi.fn(), pool: {}, withTenantTransaction: vi.fn(), withTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ configureRedis: vi.fn(), redis: {}, publish: vi.fn() }))
vi.mock('../lib/stripe.js', () => ({
  StripeErrors: { StripeError: class StripeError extends Error {} },
  reloadStripeFromDb: vi.fn().mockResolvedValue(undefined),
}))

// The service layer is mocked: this suite asserts the *wiring* (validation,
// scoping, error mapping), not the service behaviour (covered elsewhere).
vi.mock('../services/payment.service.js', () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ transactionId: 'tx-1' }),
  listIntents: vi.fn(), getIntent: vi.fn(), cancelIntent: vi.fn(),
  captureIntent: vi.fn(), createRefund: vi.fn(), listRefunds: vi.fn(),
}))
vi.mock('../services/webhook.service.js', () => ({
  constructWebhookEvent: vi.fn(), handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))
// admin.routes pulls in the config repo; stub the route plugin to keep this
// focused on payment + webhook wiring.
vi.mock('../routes/admin.routes.js', () => ({ adminRoutes: async () => {} }))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'user' }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    },
  }
})

import { register } from '../index.js'
import * as service from '../services/payment.service.js'
import { constructWebhookEvent } from '../services/webhook.service.js'

const UUID = '11111111-1111-1111-1111-111111111111'

let app
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await register({ app, db: {}, redis: {} })
  await app.ready()
})
afterEach(async () => { await app.close() })

describe('register() — zod validation is actually wired', () => {
  it('rejects an invalid body with 422 (compiler is set on the scope)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/intents',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      payload: { amount: 5000, userId: UUID }, // missing idempotencyKey
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
    expect(service.createPaymentIntent).not.toHaveBeenCalled()
  })

  it('accepts a valid body and reaches the service scoped to the tenant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/intents',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      payload: { amount: 5000, currency: 'eur', userId: UUID, idempotencyKey: 'k1' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1' }),
      expect.objectContaining({ amount: 5000, idempotencyKey: 'k1' }),
    )
  })
})

describe('register() — webhook signature path is public + verified', () => {
  it('400 MISSING_SIGNATURE when the header is absent (no JWT required)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/stripe',
      headers: { 'Content-Type': 'application/json' }, payload: { x: 1 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('MISSING_SIGNATURE')
  })

  it('400 INVALID_SIGNATURE when verification throws', async () => {
    constructWebhookEvent.mockRejectedValue(new Error('bad sig'))
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' }, payload: { x: 1 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_SIGNATURE')
  })

  it('200 received:true on a valid signature', async () => {
    constructWebhookEvent.mockResolvedValue({ id: 'evt_1', type: 'payment_intent.succeeded' })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' }, payload: { x: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })
})
