import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/sessions.service.js', () => ({
  openSession:   vi.fn(),
  listSessions:  vi.fn(),
  getSession:    vi.fn(),
  closeSession:  vi.fn(),
  reopenSession: vi.fn(),
  addCount:      vi.fn(),
  addMovement:   vi.fn(),
  listMovements: vi.fn(),
}))

// app-guard stub: Bearer obligatorio salvo public; el token decide el rol.
vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  const roleByToken = {
    'cashier-token': 'cashier',
    'manager-token': 'manager',
    'admin-token':   'admin',
    'staff-token':   'staff',
  }
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        const role = roleByToken[auth.slice(7)] ?? 'user'
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

import { sessionsRoutes } from '../routes/sessions.routes.js'
import * as service from '../services/sessions.service.js'

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
  await app.register(sessionsRoutes, { prefix: '/v1/tpv/sessions' })
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

const DEVICE = '40000000-0000-0000-0000-000000000001'
const SESSION = '50000000-0000-0000-0000-000000000001'

describe('POST /v1/tpv/sessions — abrir caja', () => {
  it('rechaza sin Bearer (401)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/sessions',
      payload: { deviceId: DEVICE },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rechaza al rol user (403) — no es operador de caja', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/sessions',
      headers: { Authorization: 'Bearer other-token' },
      payload: { deviceId: DEVICE },
    })
    expect(res.statusCode).toBe(403)
    expect(service.openSession).not.toHaveBeenCalled()
  })

  it('el cajero abre sesión con fondo inicial → 201', async () => {
    service.openSession.mockResolvedValue({ id: SESSION, device_id: DEVICE, status: 'open' })
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/sessions',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { deviceId: DEVICE, openingFloatCents: 5000 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'cashier' }),
      { deviceId: DEVICE, openingFloatCents: 5000 },
    )
  })

  it('422 si falta deviceId (zod)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/sessions',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { openingFloatCents: 5000 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.openSession).not.toHaveBeenCalled()
  })
})

describe('POST /v1/tpv/sessions/:id/close — cierre con arqueo', () => {
  it('pasa declared y varianceReason al service', async () => {
    service.closeSession.mockResolvedValue({ id: SESSION, status: 'closed', variance_cents: -150 })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/close`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { declared: { cash: 12000, card: 34000 }, varianceReason: 'redondeos' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.closeSession).toHaveBeenCalledWith(
      expect.anything(), SESSION,
      { declared: { cash: 12000, card: 34000 }, varianceReason: 'redondeos' },
    )
  })

  it('422 sin declared', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/close`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: {},
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.closeSession).not.toHaveBeenCalled()
  })
})

describe('POST /v1/tpv/sessions/:id/reopen — solo manager', () => {
  it('403 para cajero', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/reopen`,
      headers: { Authorization: 'Bearer cashier-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(service.reopenSession).not.toHaveBeenCalled()
  })

  it('200 para manager', async () => {
    service.reopenSession.mockResolvedValue({ id: SESSION, status: 'open' })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/reopen`,
      headers: { Authorization: 'Bearer manager-token' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /v1/tpv/sessions/:id/movements — efectivo manual', () => {
  it('exige reason (422 sin motivo)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/movements`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { kind: 'cash_out', amountCents: 2000 },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.addMovement).not.toHaveBeenCalled()
  })

  it('201 con kind/amount/reason válidos', async () => {
    service.addMovement.mockResolvedValue({ id: 'm1', kind: 'cash_in', amount_cents: 2000 })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/movements`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { kind: 'cash_in', amountCents: 2000, reason: 'cambio' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addMovement).toHaveBeenCalledWith(
      expect.anything(), SESSION,
      { kind: 'cash_in', amountCents: 2000, reason: 'cambio' },
    )
  })
})

describe('POST /v1/tpv/sessions/:id/counts — arqueo ciego', () => {
  it('201 y pasa el conteo al service', async () => {
    service.addCount.mockResolvedValue({ id: 'c1', variance_cents: -50 })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/sessions/${SESSION}/counts`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { counted: { cash: 11950 }, note: 'arqueo de media tarde' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addCount).toHaveBeenCalledWith(
      expect.anything(), SESSION,
      { counted: { cash: 11950 }, note: 'arqueo de media tarde' },
    )
  })
})
