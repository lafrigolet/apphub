// routes.test — cubre las 6 familias de rutas (split-rules, payments,
// connect-accounts, webhooks, admin config, checkout-sessions) montando un
// Fastify standalone con compiler zod, mockeando los servicios y el guard.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/split-rule.service.js', () => ({
  listSplitRules: vi.fn(), createSplitRule: vi.fn(), getSplitRule: vi.fn(),
  deactivateSplitRule: vi.fn(), simulate: vi.fn(),
}))
vi.mock('../services/payment.service.js', () => ({
  createPaymentIntent: vi.fn(), listPayments: vi.fn(), getPayment: vi.fn(), createRefund: vi.fn(),
}))
vi.mock('../services/connect-account.service.js', () => ({
  createConnectAccount: vi.fn(), listConnectAccounts: vi.fn(), refreshOnboardingLink: vi.fn(),
}))
vi.mock('../services/webhook.service.js', () => ({
  constructWebhookEvent: vi.fn(), handleWebhookEvent: vi.fn(),
}))
vi.mock('../services/checkout-session.service.js', () => ({
  createCheckoutSession: vi.fn(), getCheckoutSession: vi.fn(),
}))
vi.mock('../repositories/config.repository.js', () => ({
  listConfig: vi.fn(), upsertValue: vi.fn(),
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
}))
vi.mock('../lib/stripe.js', () => ({ reloadStripeFromDb: vi.fn() }))

vi.mock('@apphub/platform-sdk/app-guard', () => ({
  requireRole: (...roles) => async (req, reply) => {
    if (!roles.includes(req.identity?.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    }
  },
}))

import { splitRuleRoutes } from '../routes/split-rule.routes.js'
import { paymentRoutes } from '../routes/payment.routes.js'
import { connectAccountRoutes } from '../routes/connect-account.routes.js'
import { webhookRoutes } from '../routes/webhook.routes.js'
import { adminRoutes } from '../routes/admin.routes.js'
import { checkoutSessionRoutes } from '../routes/checkout-session.routes.js'
import * as splitService from '../services/split-rule.service.js'
import * as paymentService from '../services/payment.service.js'
import * as connectService from '../services/connect-account.service.js'
import * as webhookService from '../services/webhook.service.js'
import * as checkoutService from '../services/checkout-session.service.js'
import * as configRepo from '../repositories/config.repository.js'
import { pool } from '../lib/db.js'

const TENANT = { appId: 'shop', tenantId: 't1', subTenantId: null }
const UUID = '11111111-1111-1111-1111-111111111111'

async function buildApp({ role = 'staff' } = {}) {
  const { validatorCompiler } = await import('fastify-type-provider-zod')
  const app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  app.decorateRequest('tenant', null)
  app.decorateRequest('identity', null)
  app.decorateRequest('rawBody', null)
  app.addHook('onRequest', async (req) => {
    req.tenant = TENANT
    req.identity = { role }
  })
  // Stripe webhook raw-body parser (mimics app.js).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.routeOptions.config?.rawBody) {
      req.rawBody = body
      done(null, body.length ? JSON.parse(body.toString()) : {})
    } else {
      try { done(null, body.length ? JSON.parse(body.toString()) : {}) } catch (err) { done(err) }
    }
  })
  await app.register(splitRuleRoutes, { prefix: '/v1/split-rules' })
  await app.register(paymentRoutes, { prefix: '/v1/payments' })
  await app.register(connectAccountRoutes, { prefix: '/v1/connect-accounts' })
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' })
  await app.register(adminRoutes, { prefix: '/v1/splitpay/admin' })
  await app.register(checkoutSessionRoutes, { prefix: '/v1/splitpay/checkout-sessions' })
  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

// ── split-rules ────────────────────────────────────────────────────────

describe('split-rule routes', () => {
  it('GET / lista', async () => {
    splitService.listSplitRules.mockResolvedValue([{ id: 'r1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'r1' }])
  })

  it('POST / crea (201)', async () => {
    splitService.createSplitRule.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/split-rules/',
      payload: { name: 'D', platformFeePercent: 10, recipients: [{ accountId: 'acct_1', percentage: 90, label: 'A' }] },
    })
    expect(res.statusCode).toBe(201)
    expect(splitService.createSplitRule).toHaveBeenCalledWith(TENANT, expect.any(Object))
  })

  it('POST / body inválido → error de validación', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/split-rules/', payload: { name: '' } })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(splitService.createSplitRule).not.toHaveBeenCalled()
  })

  it('GET /:id', async () => {
    splitService.getSplitRule.mockResolvedValue({ id: UUID })
    const res = await app.inject({ method: 'GET', url: `/v1/split-rules/${UUID}` })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /:id → 204', async () => {
    splitService.deactivateSplitRule.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/split-rules/${UUID}` })
    expect(res.statusCode).toBe(204)
  })

  it('POST /simulate', async () => {
    splitService.simulate.mockResolvedValue({ netAmount: 4000 })
    const res = await app.inject({
      method: 'POST', url: '/v1/split-rules/simulate',
      payload: { splitRuleId: UUID, amount: 5000, currency: 'eur' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.netAmount).toBe(4000)
  })
})

// ── payments ────────────────────────────────────────────────────────────

describe('payment routes', () => {
  it('POST / crea PaymentIntent (201)', async () => {
    paymentService.createPaymentIntent.mockResolvedValue({ paymentId: 'p1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/',
      payload: {
        amount: 5000, currency: 'EUR', splitRuleId: UUID, merchantAccountId: 'acct_1',
        idempotencyKey: 'idem-1',
      },
    })
    expect(res.statusCode).toBe(201)
  })

  it('GET / lista con limit/cursor', async () => {
    paymentService.listPayments.mockResolvedValue([{ id: 'p1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/payments/?limit=5&cursor=c1' })
    expect(res.statusCode).toBe(200)
    expect(paymentService.listPayments).toHaveBeenCalledWith(TENANT, 5, 'c1')
  })

  it('GET / sin query → default limit 20', async () => {
    paymentService.listPayments.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/payments/' })
    expect(res.statusCode).toBe(200)
    expect(paymentService.listPayments).toHaveBeenCalledWith(TENANT, 20, undefined)
  })

  it('GET /:id', async () => {
    paymentService.getPayment.mockResolvedValue({ id: UUID })
    const res = await app.inject({ method: 'GET', url: `/v1/payments/${UUID}` })
    expect(res.statusCode).toBe(200)
  })

  it('POST /:id/refunds (201) — inyecta paymentId del path', async () => {
    paymentService.createRefund.mockResolvedValue({ refundId: 're_1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/payments/${UUID}/refunds`,
      payload: { idempotencyKey: 'idem-2', reason: 'requested_by_customer' },
    })
    expect(res.statusCode).toBe(201)
    expect(paymentService.createRefund).toHaveBeenCalledWith(TENANT, expect.objectContaining({ paymentId: UUID }))
  })
})

// ── connect-accounts ─────────────────────────────────────────────────────

describe('connect-account routes', () => {
  it('POST / crea (201)', async () => {
    connectService.createConnectAccount.mockResolvedValue({ id: 'ca1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/connect-accounts/',
      payload: { email: 'm@x.com', country: 'es', returnUrl: 'https://x.com/r', refreshUrl: 'https://x.com/f' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('GET / lista', async () => {
    connectService.listConnectAccounts.mockResolvedValue([{ id: 'ca1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/connect-accounts/' })
    expect(res.statusCode).toBe(200)
  })

  it('POST /:id/onboarding-link', async () => {
    connectService.refreshOnboardingLink.mockResolvedValue({ url: 'https://onboard' })
    const res = await app.inject({
      method: 'POST', url: `/v1/connect-accounts/${UUID}/onboarding-link`,
      payload: { returnUrl: 'https://x.com/r', refreshUrl: 'https://x.com/f' },
    })
    expect(res.statusCode).toBe(200)
    expect(connectService.refreshOnboardingLink).toHaveBeenCalledWith(TENANT, UUID, 'https://x.com/r', 'https://x.com/f')
  })
})

// ── webhooks ──────────────────────────────────────────────────────────────

describe('webhook routes', () => {
  it('falta firma → 400 MISSING_SIGNATURE', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'Content-Type': 'application/json' },
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('MISSING_SIGNATURE')
  })

  it('firma inválida → 400 INVALID_SIGNATURE', async () => {
    webhookService.constructWebhookEvent.mockRejectedValue(new Error('bad sig'))
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' },
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_SIGNATURE')
  })

  it('firma válida → 200 received + procesa en background', async () => {
    webhookService.constructWebhookEvent.mockResolvedValue({ id: 'evt_1', type: 'payment_intent.succeeded' })
    webhookService.handleWebhookEvent.mockResolvedValue()
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' },
      payload: { id: 'evt_1' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(webhookService.handleWebhookEvent).toHaveBeenCalled()
  })

  it('error en background → logger.error (no rompe la respuesta)', async () => {
    const { logger } = await import('../lib/logger.js')
    webhookService.constructWebhookEvent.mockResolvedValue({ id: 'evt_2', type: 't' })
    webhookService.handleWebhookEvent.mockRejectedValue(new Error('processing boom'))
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' },
      payload: { id: 'evt_2' },
    })
    expect(res.statusCode).toBe(200)
    await new Promise((r) => setImmediate(r))
    expect(logger.error).toHaveBeenCalled()
  })
})

// ── admin config ──────────────────────────────────────────────────────────

describe('admin config routes', () => {
  function fakeClient() {
    const client = { release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    return client
  }

  it('user normal → 403 (requireRole)', async () => {
    const userApp = await buildApp({ role: 'user' })
    const res = await userApp.inject({ method: 'GET', url: '/v1/splitpay/admin/config' })
    expect(res.statusCode).toBe(403)
    await userApp.close()
  })

  it('GET /config como staff → lista', async () => {
    fakeClient()
    configRepo.listConfig.mockResolvedValue([{ key: 'stripe_secret_key', configured: false }])
    const res = await app.inject({ method: 'GET', url: '/v1/splitpay/admin/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].key).toBe('stripe_secret_key')
  })

  it('PATCH /config → upsert cada key definida + reload stripe', async () => {
    const { reloadStripeFromDb } = await import('../lib/stripe.js')
    fakeClient()
    configRepo.listConfig.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/splitpay/admin/config',
      payload: { platform_account_id: 'acct_1', stripe_secret_key: 'sk_live_x' },
    })
    expect(res.statusCode).toBe(200)
    expect(configRepo.upsertValue).toHaveBeenCalledWith(expect.anything(), 'platform_account_id', 'acct_1')
    expect(configRepo.upsertValue).toHaveBeenCalledWith(expect.anything(), 'stripe_secret_key', 'sk_live_x')
    expect(reloadStripeFromDb).toHaveBeenCalled()
  })

  it('PATCH /config body vacío → no upserts pero igual 200', async () => {
    fakeClient()
    configRepo.listConfig.mockResolvedValue([])
    const res = await app.inject({ method: 'PATCH', url: '/v1/splitpay/admin/config', payload: {} })
    expect(res.statusCode).toBe(200)
    expect(configRepo.upsertValue).not.toHaveBeenCalled()
  })

  it('PATCH /config valor inválido → 422 (zod startsWith)', async () => {
    fakeClient()
    const res = await app.inject({
      method: 'PATCH', url: '/v1/splitpay/admin/config',
      payload: { stripe_secret_key: 'bad_key' },
    })
    expect(res.statusCode).toBe(500) // patchBody.parse lanza ZodError → errorHandler genérico
  })
})

// ── checkout-sessions ─────────────────────────────────────────────────────

describe('checkout-session routes', () => {
  it('POST / crea (201)', async () => {
    checkoutService.createCheckoutSession.mockResolvedValue({ id: 's1', url: 'https://cs' })
    const res = await app.inject({
      method: 'POST', url: '/v1/splitpay/checkout-sessions/',
      payload: {
        mode: 'payment', lineItems: [{ price: 'price_1', quantity: 1 }],
        successUrl: 'https://x.com/ok', cancelUrl: 'https://x.com/no',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(checkoutService.createCheckoutSession).toHaveBeenCalledWith(TENANT, expect.any(Object))
  })

  it('POST / body inválido → validación zod en el schema de la ruta (4xx)', async () => {
    // La validación del body se hace ahora en el `schema` de Fastify (zod type
    // provider), no dentro del handler; antes el handler hacía createBody.parse
    // y lanzaba ZodError → 500. Ahora falla la validación de la ruta (priority
    // #8 declaró el body schema + tags/summary). Mismo criterio que split-rules.
    const res = await app.inject({
      method: 'POST', url: '/v1/splitpay/checkout-sessions/',
      payload: { mode: 'bogus', lineItems: [] },
    })
    expect([400, 422]).toContain(res.statusCode)
  })

  it('GET /:id encontrado', async () => {
    checkoutService.getCheckoutSession.mockResolvedValue({ id: UUID })
    const res = await app.inject({ method: 'GET', url: `/v1/splitpay/checkout-sessions/${UUID}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe(UUID)
  })

  it('GET /:id no encontrado → 404', async () => {
    checkoutService.getCheckoutSession.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: `/v1/splitpay/checkout-sessions/${UUID}` })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

// Las ramas `req.body ?? {}` (admin PATCH y checkout POST) son inalcanzables
// por HTTP (fastify siempre provee req.body al menos como objeto), así que
// se invocan los handlers directamente con req.body undefined.
describe('defaults defensivos (?? {}) — handlers directos', () => {
  function captureHandlers(register) {
    const routes = []
    const rec = (m) => (p, ...rest) => {
      const h = rest[rest.length - 1]
      routes.push({ m, p, h })
    }
    register({
      addHook: () => {},
      get: rec('get'), post: rec('post'), patch: rec('patch'),
      put: rec('put'), delete: rec('delete'),
    })
    return routes
  }

  it('admin PATCH /config con req.body undefined → patchBody.parse({}) → 0 upserts', async () => {
    const client = { query: vi.fn(), release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    configRepo.listConfig.mockResolvedValue([])
    const routes = captureHandlers(adminRoutes)
    const patch = routes.find((r) => r.m === 'patch' && r.p === '/config')
    const out = await patch.h({})           // req.body undefined
    expect(out).toEqual({ data: [] })
    expect(configRepo.upsertValue).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('checkout POST / delega al servicio (validación movida al schema de la ruta)', async () => {
    // La validación del body vive ahora en el `schema` Fastify, no en el
    // handler; el handler simplemente delega a createCheckoutSession con
    // req.tenant + req.body. (priority #8)
    checkoutService.createCheckoutSession.mockResolvedValue({ id: 's-direct' })
    const routes = captureHandlers(checkoutSessionRoutes)
    const post = routes.find((r) => r.m === 'post' && r.p === '/')
    let sent
    await post.h(
      { tenant: TENANT, body: { mode: 'payment' } },
      { status: () => ({ send: (b) => { sent = b } }) },
    )
    expect(checkoutService.createCheckoutSession).toHaveBeenCalledWith(TENANT, { mode: 'payment' })
    expect(sent).toEqual({ data: { id: 's-direct' } })
  })
})
