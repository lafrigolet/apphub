// solar-calculator.routes — GET público + PATCH con cross-app guard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../services/solar-calculator.service.js', async () => {
  const actual = await vi.importActual('../services/solar-calculator.service.js')
  return {
    ...actual,
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  }
})

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        const auth = req.headers.authorization ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
        if (token) {
          // token formato "role:appId"
          const [role, appId] = token.split(':')
          req.identity = { userId: 'u1', appId: appId ?? 'aikikan', tenantId: 't1', role }
        }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    },
  }
})

import * as svc from '../services/solar-calculator.service.js'
import { solarCalculatorRoutes } from '../routes/solar-calculator.routes.js'

const validConfig = {
  irradianceHours: 1650, pricePerKwh: 0.18, installCostPerKwp: 1200,
  co2KgPerKwh: 0.27, m2PerKwp: 5, monthlyBillPerKwp: 25,
  installations: {
    residential: { label: 'Res', billUplift: 1.0, selfConsumption: 0.75 },
    business: { label: 'Emp', billUplift: 1.4, selfConsumption: 0.85 },
  },
  orientations: [{ label: 'Sur', factor: 1.0 }],
}

async function buildApp() {
  const app = Fastify({ logger: false })
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(solarCalculatorRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('GET /v1/apps/:appId/solar-calculator (público)', () => {
  it('devuelve la config', async () => {
    svc.getConfig.mockResolvedValue({ pricePerKwh: 0.2 })
    const res = await app.inject({ method: 'GET', url: '/v1/apps/js-electric/solar-calculator' })
    expect(res.statusCode).toBe(200)
    expect(res.json().pricePerKwh).toBe(0.2)
  })
})

describe('PATCH /v1/apps/:appId/solar-calculator', () => {
  it('admin del mismo app → 200', async () => {
    svc.setConfig.mockResolvedValue(validConfig)
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/js-electric/solar-calculator',
      headers: { Authorization: 'Bearer admin:js-electric', 'Content-Type': 'application/json' },
      payload: validConfig,
    })
    expect(res.statusCode).toBe(200)
    expect(svc.setConfig).toHaveBeenCalledWith('js-electric', expect.objectContaining({ pricePerKwh: 0.18 }))
  })

  it('staff (rol plataforma) puede editar cualquier app', async () => {
    svc.setConfig.mockResolvedValue(validConfig)
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/js-electric/solar-calculator',
      headers: { Authorization: 'Bearer staff:aikikan', 'Content-Type': 'application/json' },
      payload: validConfig,
    })
    expect(res.statusCode).toBe(200)
  })

  it('admin de OTRO app → 403 (cross-app guard)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/js-electric/solar-calculator',
      headers: { Authorization: 'Bearer admin:aikikan', 'Content-Type': 'application/json' },
      payload: validConfig,
    })
    expect(res.statusCode).toBe(403)
    expect(svc.setConfig).not.toHaveBeenCalled()
  })

  it('rol no autorizado (user) → 403 por requireRole', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/js-electric/solar-calculator',
      headers: { Authorization: 'Bearer user:js-electric', 'Content-Type': 'application/json' },
      payload: validConfig,
    })
    expect(res.statusCode).toBe(403)
  })

  it('body inválido → 422', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/js-electric/solar-calculator',
      headers: { Authorization: 'Bearer admin:js-electric', 'Content-Type': 'application/json' },
      payload: { pricePerKwh: -1 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(svc.setConfig).not.toHaveBeenCalled()
  })
})
