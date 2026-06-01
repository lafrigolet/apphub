// bootstrap.routes — provisioning Fase A (staff-only), onboarding list,
// estado derivado (Fase B, cualquier user), reenvío y revocación.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../services/bootstrap.service.js')

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        const auth = req.headers.authorization ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
        if (token) req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role: token === 'staff' ? 'staff' : 'user' }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    },
  }
})

import * as service from '../services/bootstrap.service.js'
import { bootstrapRoutes } from '../routes/bootstrap.routes.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) { const r = schema.safeParse(data); return r.success ? { value: r.data } : { error: r.error } }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(bootstrapRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const staff = { Authorization: 'Bearer staff', 'Content-Type': 'application/json' }
const user = { Authorization: 'Bearer user', 'Content-Type': 'application/json' }
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const validBootstrap = {
  app: { appId: 'aikikan', displayName: 'Aikikan', subdomain: 'aikikan' },
  tenant: { displayName: 'Dojo', subdomain: 'dojo', contactEmail: 'c@x.com' },
  owner: { email: 'owner@x.com', displayName: 'Owner' },
}

describe('POST /v1/tenants/bootstrap', () => {
  it('staff → 201', async () => {
    service.bootstrapTenant.mockResolvedValue({ tenant: { id: 't1' } })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/bootstrap', headers: staff, payload: validBootstrap })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.tenant.id).toBe('t1')
  })

  it('user → 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/bootstrap', headers: user, payload: validBootstrap })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/tenants/onboarding (staff)', () => {
  it('lista pending', async () => {
    service.listPendingTenants.mockResolvedValue([{ id: 't1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/onboarding', headers: { Authorization: 'Bearer staff' } })
    expect(res.json().data).toEqual([{ id: 't1' }])
  })

  it('user → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/onboarding', headers: { Authorization: 'Bearer user' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/tenants/:id/bootstrap (cualquier user)', () => {
  it('devuelve estado derivado', async () => {
    service.getBootstrapStatus.mockResolvedValue({ tenantId: 't1', steps: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/t1/bootstrap', headers: { Authorization: 'Bearer user' } })
    expect(res.json().data.tenantId).toBe('t1')
  })
})

describe('resend-activation + revoke (staff)', () => {
  it('POST resend-activation', async () => {
    service.resendActivation.mockResolvedValue({ magicLinkUrl: 'http://m' })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/resend-activation', headers: staff, payload: {} })
    expect(res.json().data.magicLinkUrl).toBe('http://m')
  })

  it('DELETE bootstrap (revoke) → 200', async () => {
    service.revokeBootstrap.mockResolvedValue({ tenantId: 't1' })
    const res = await app.inject({ method: 'DELETE', url: '/v1/tenants/t1/bootstrap', headers: { Authorization: 'Bearer staff' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.tenantId).toBe('t1')
  })

  it('revoke user → 403', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/tenants/t1/bootstrap', headers: { Authorization: 'Bearer user' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('actorFromRequest defaults (?? null) — handlers directos', () => {
  // Recorder fake-fastify para capturar handlers e invocarlos con
  // req.identity ausente / req.ip ausente → ejercita las ramas `?? null`.
  async function handlers() {
    const routes = []
    const push = (m) => (p, o, h) => routes.push({ m, p, h: h ?? o })
    await bootstrapRoutes({
      post: push('post'), get: push('get'), delete: push('delete'),
    })
    return routes
  }
  const find = (rs, m, p) => rs.find((r) => r.m === m && r.p === p)

  it('POST bootstrap sin identity ni ip → actor {userId:null, role:null, ip:null}', async () => {
    service.bootstrapTenant.mockResolvedValue({ tenant: { id: 't1' } })
    const rs = await handlers()
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    await find(rs, 'post', '/v1/tenants/bootstrap').h({ body: validBootstrap }, reply)
    expect(service.bootstrapTenant).toHaveBeenCalledWith(validBootstrap, { userId: null, role: null, ip: null })
  })

  it('POST resend-activation con identity parcial → role null, ip presente', async () => {
    service.resendActivation.mockResolvedValue({ magicLinkUrl: 'http://m' })
    const rs = await handlers()
    const out = await find(rs, 'post', '/v1/tenants/:id/resend-activation').h({
      params: { id: 't1' }, identity: { userId: 'u9' }, ip: '9.9.9.9',
    })
    expect(out.data.magicLinkUrl).toBe('http://m')
    expect(service.resendActivation).toHaveBeenCalledWith('t1', { userId: 'u9', role: null, ip: '9.9.9.9' })
  })
})
