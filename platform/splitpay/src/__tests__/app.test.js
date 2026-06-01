// app.test — cubre createApp(): health, 404, raw-body parser para webhooks,
// y el errorHandler completo (ZodError/FST_ERR_VALIDATION, StripeError,
// AppError <500/>=500, 404 nativo, error genérico).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Stripe from 'stripe'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SPLITPAY_STRIPE_SECRET_KEY: 'sk_test' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenant: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('../lib/stripe.js', () => ({ stripe: {}, getWebhookSecret: vi.fn(), reloadStripeFromDb: vi.fn() }))

// tenantPlugin = appGuard re-export. Lo stubbeamos para inyectar req.tenant.
vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('tenant', null)
      fastify.addHook('onRequest', async (req) => {
        req.tenant = { appId: 'shop', tenantId: 't1', subTenantId: null }
      })
    }),
    requireRole: () => async () => {},
  }
})

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

import { createApp } from '../app.js'
import { AppError } from '../utils/errors.js'
import * as splitService from '../services/split-rule.service.js'
import { logger } from '../lib/logger.js'

let app
beforeEach(async () => { vi.clearAllMocks(); app = createApp(); await app.ready() })
afterEach(async () => { await app.close() })

describe('createApp — health & 404', () => {
  it('GET /health → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', service: 'split-payments' })
  })

  it('GET /unknown → 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

describe('createApp — errorHandler', () => {
  it('validación (FST_ERR_VALIDATION) → 422 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/split-rules/',
      headers: { 'Content-Type': 'application/json' },
      payload: { name: '' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('AppError <500 → status del error + warn', async () => {
    splitService.listSplitRules.mockRejectedValue(new AppError('NOT_FOUND', 'x', 404))
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('AppError >=500 → logger.error', async () => {
    splitService.listSplitRules.mockRejectedValue(new AppError('UPSTREAM', 'boom', 503))
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(503)
    expect(logger.error).toHaveBeenCalled()
  })

  it('StripeError → STRIPE_ERROR con statusCode del error', async () => {
    const stripeErr = new Stripe.errors.StripeCardError({ message: 'card declined', code: 'card_declined' })
    stripeErr.statusCode = 402
    splitService.listSplitRules.mockRejectedValue(stripeErr)
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe('STRIPE_ERROR')
  })

  it('StripeError sin statusCode → 502 default', async () => {
    const stripeErr = new Stripe.errors.StripeAPIError({ message: 'api down' })
    delete stripeErr.statusCode
    splitService.listSplitRules.mockRejectedValue(stripeErr)
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(502)
  })

  it('error genérico → 500 INTERNAL_ERROR', async () => {
    splitService.listSplitRules.mockRejectedValue(new Error('boom'))
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
  })

  it('error nativo Fastify con statusCode 404 → NOT_FOUND (rama 404)', async () => {
    // Un error que no es AppError pero lleva statusCode 404 (p.ej. error nativo
    // de Fastify propagado al errorHandler) ejercita la rama `statusCode === 404`.
    const nativeErr = Object.assign(new Error('missing'), { statusCode: 404 })
    splitService.listSplitRules.mockRejectedValue(nativeErr)
    const res = await app.inject({ method: 'GET', url: '/v1/split-rules/' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

describe('createApp — raw body parser', () => {
  it('webhook con rawBody parsea JSON y deja req.rawBody disponible', async () => {
    const { constructWebhookEvent, handleWebhookEvent } = await import('../services/webhook.service.js')
    constructWebhookEvent.mockResolvedValue({ id: 'evt_1', type: 't' })
    handleWebhookEvent.mockResolvedValue()
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'sig' },
      payload: JSON.stringify({ id: 'evt_1' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(constructWebhookEvent).toHaveBeenCalled()
  })

  it('JSON malformado en ruta normal → error de parseo (catch del parser)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/split-rules/',
      headers: { 'Content-Type': 'application/json' },
      payload: '{bad json',
    })
    expect([400, 500]).toContain(res.statusCode)
  })
})
