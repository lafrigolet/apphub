// terminal.routes wiring: connection-token + card_present intent endpoints,
// tenant scoping and auth. Service is mocked (Stripe is exercised in the
// service's own integration path, not here).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/terminal.service.js', () => ({
  createConnectionToken: vi.fn(),
  createTerminalPaymentIntent: vi.fn(),
  ensureLocation: vi.fn(),
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

import { terminalRoutes } from '../routes/terminal.routes.js'
import * as terminal from '../services/terminal.service.js'
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
  await app.register(terminalRoutes, { prefix: '/v1/payments/terminal' })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/payments/terminal/connection-token', () => {
  it('201 with the secret + locationId, scoped to req.tenant', async () => {
    terminal.createConnectionToken.mockResolvedValue({ secret: 'pst_x', locationId: 'tml_1', stub: false })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/terminal/connection-token',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual({ secret: 'pst_x', locationId: 'tml_1', stub: false })
    expect(terminal.createConnectionToken).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'tpv', tenantId: 't1' }),
    )
  })

  it('401 without Bearer', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/payments/terminal/connection-token' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /v1/payments/terminal/intents', () => {
  it('201 with a card_present intent', async () => {
    terminal.createTerminalPaymentIntent.mockResolvedValue({
      transactionId: 'tx1', paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret', status: 'requires_payment_method',
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/terminal/intents',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { amountCents: 1250 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.paymentIntentId).toBe('pi_1')
    expect(terminal.createTerminalPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'tpv', tenantId: 't1' }),
      expect.objectContaining({ amountCents: 1250, currency: 'eur' }),
    )
  })

  it('422 on missing amountCents', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/terminal/intents',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(422)
    expect(terminal.createTerminalPaymentIntent).not.toHaveBeenCalled()
  })

  it('422 on non-positive amount', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/payments/terminal/intents',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { amountCents: 0 },
    })
    expect(res.statusCode).toBe(422)
  })
})
