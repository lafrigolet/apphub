// tenants.routes — directorio público, CRUD staff-gated, subscripción.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../services/tenants.service.js')

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        const auth = req.headers.authorization ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
        if (token) {
          const role = token === 'staff' ? 'staff' : token === 'super' ? 'super_admin'
            : token === 'owner' ? 'owner' : 'user'
          req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role, email: 'o@x.com' }
        }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    },
  }
})

import * as service from '../services/tenants.service.js'
import { tenantsRoutes, isValidTimezone } from '../routes/tenants.routes.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) { const r = schema.safeParse(data); return r.success ? { value: r.data } : { error: r.error } }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(tenantsRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const staff = { Authorization: 'Bearer staff', 'Content-Type': 'application/json' }
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
const user = { Authorization: 'Bearer user', 'Content-Type': 'application/json' }
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('isValidTimezone', () => {
  it('acepta zonas IANA conocidas', () => {
    expect(isValidTimezone('Europe/Madrid')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
  })
  it('rechaza zonas desconocidas y valores no-string', () => {
    expect(isValidTimezone('Mars/Phobos')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(null)).toBe(false)
    expect(isValidTimezone(123)).toBe(false)
  })
})

describe('GET /v1/tenants/public', () => {
  it('sin appId → []', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/public' })
    expect(res.json()).toEqual([])
  })

  it('con appId → solo activos, campos mínimos', async () => {
    service.listTenants.mockResolvedValue([
      { id: 't1', display_name: 'A', subdomain: 'a', status: 'active' },
      { id: 't2', display_name: 'B', subdomain: 'b', status: 'suspended' },
    ])
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/public?appId=aikikan' })
    const json = res.json()
    expect(json).toHaveLength(1)
    expect(json[0]).toEqual({ id: 't1', display_name: 'A', subdomain: 'a' })
  })
})

describe('GET /v1/tenants', () => {
  it('lista con appId de query', async () => {
    service.listTenants.mockResolvedValue([{ id: 't1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/tenants?appId=aikikan', headers: { Authorization: 'Bearer user' } })
    expect(res.statusCode).toBe(200)
    expect(service.listTenants).toHaveBeenCalledWith('aikikan')
  })

  it('sin appId → null', async () => {
    service.listTenants.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/tenants', headers: { Authorization: 'Bearer user' } })
    expect(service.listTenants).toHaveBeenCalledWith(null)
  })
})

describe('GET by subdomain + by id', () => {
  it('by-subdomain (público)', async () => {
    service.getTenantBySubdomain.mockResolvedValue({ tenantId: 't1' })
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/by-subdomain/dojo' })
    expect(res.json().tenantId).toBe('t1')
  })

  it('GET /:id', async () => {
    service.getTenant.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/t1', headers: { Authorization: 'Bearer user' } })
    expect(res.json().id).toBe('t1')
  })
})

describe('POST /v1/tenants (staff)', () => {
  it('staff crea → 201', async () => {
    service.createTenant.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants', headers: staff, payload: { appId: 'a', displayName: 'D', subdomain: 's' } })
    expect(res.statusCode).toBe(201)
    expect(service.createTenant).toHaveBeenCalledWith(expect.objectContaining({ appId: 'a' }), expect.objectContaining({ userId: 'u1' }))
  })

  it('user normal → 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tenants', headers: user, payload: { appId: 'a', displayName: 'D', subdomain: 's' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH endpoints (staff)', () => {
  it('PATCH /:id actualiza', async () => {
    service.updateTenant.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'PATCH', url: '/v1/tenants/t1', headers: staff, payload: { displayName: 'New' } })
    expect(res.statusCode).toBe(200)
  })

  it('PATCH /:id acepta timezone válida + requiresUserApproval', async () => {
    service.updateTenant.mockResolvedValue({ id: 't1' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenants/t1', headers: staff,
      payload: { timezone: 'Europe/Madrid', requiresUserApproval: true },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateTenant).toHaveBeenCalledWith(
      't1', expect.objectContaining({ timezone: 'Europe/Madrid', requiresUserApproval: true }), expect.anything(),
    )
  })

  it('PATCH /:id rechaza timezone inválida (no llega al service)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenants/t1', headers: staff,
      payload: { timezone: 'Mars/Phobos' },
    })
    // La validación Zod lanza antes de tocar el service. En platform-core el
    // error handler global mapea ZodError → 422; aquí basta comprobar que la
    // petición no fue exitosa y que el service nunca se invocó.
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(service.updateTenant).not.toHaveBeenCalled()
  })

  it('PATCH /:id/status cambia estado', async () => {
    service.setTenantStatus.mockResolvedValue({ id: 't1', status: 'suspended' })
    const res = await app.inject({ method: 'PATCH', url: '/v1/tenants/t1/status', headers: staff, payload: { status: 'suspended', reason: 'x' } })
    expect(res.statusCode).toBe(200)
    expect(service.setTenantStatus).toHaveBeenCalledWith('t1', { status: 'suspended', reason: 'x' }, expect.anything())
  })

  it('PATCH /:id/status user → 403', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/v1/tenants/t1/status', headers: user, payload: { status: 'active' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('subscription', () => {
  it('GET /:id/subscription', async () => {
    service.getTenantSubscription.mockResolvedValue({ tenantId: 't1', priceConfigured: true })
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/t1/subscription', headers: owner })
    expect(res.json().priceConfigured).toBe(true)
  })

  it('POST /:id/subscribe pasa bearer + body', async () => {
    service.startSubscriptionCheckout.mockResolvedValue({ url: 'http://cs', sessionId: 'cs_1' })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/subscribe', headers: owner, payload: { returnUrl: 'http://back' } })
    expect(res.statusCode).toBe(200)
    expect(service.startSubscriptionCheckout).toHaveBeenCalledWith('t1', expect.objectContaining({ role: 'owner' }), 'owner', { returnUrl: 'http://back' })
  })

  it('POST /:id/subscribe sin Bearer → bearer null (rama ternaria)', async () => {
    service.startSubscriptionCheckout.mockResolvedValue({ url: 'u', sessionId: 's' })
    const res = await app.inject({
      method: 'POST', url: '/v1/tenants/t1/subscribe',
      headers: { 'Content-Type': 'application/json' }, payload: { returnUrl: 'http://back' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.startSubscriptionCheckout).toHaveBeenCalledWith('t1', null, null, { returnUrl: 'http://back' })
  })
})

describe('per-tenant enabled-modules (#7)', () => {
  it('GET /:id/enabled-modules (cualquier user)', async () => {
    service.getTenantEnabledModules.mockResolvedValue({ tenantId: 't1', source: 'app', modules: ['auth'] })
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/t1/enabled-modules', headers: user })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).toBe('app')
  })

  it('PUT /:id/enabled-modules staff → setea override', async () => {
    service.setTenantEnabledModulesOverride.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'PUT', url: '/v1/tenants/t1/enabled-modules', headers: staff, payload: { modules: ['auth', 'chat'] } })
    expect(res.statusCode).toBe(200)
    expect(service.setTenantEnabledModulesOverride).toHaveBeenCalledWith('t1', ['auth', 'chat'], expect.anything())
  })

  it('PUT /:id/enabled-modules con null limpia', async () => {
    service.setTenantEnabledModulesOverride.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'PUT', url: '/v1/tenants/t1/enabled-modules', headers: staff, payload: { modules: null } })
    expect(res.statusCode).toBe(200)
    expect(service.setTenantEnabledModulesOverride).toHaveBeenCalledWith('t1', null, expect.anything())
  })

  it('PUT /:id/enabled-modules user → 403', async () => {
    const res = await app.inject({ method: 'PUT', url: '/v1/tenants/t1/enabled-modules', headers: user, payload: { modules: [] } })
    expect(res.statusCode).toBe(403)
  })
})

describe('custom-domain verification (#5)', () => {
  // bodyless POSTs: no Content-Type header (avoids FST_ERR_CTP_EMPTY_JSON_BODY)
  const staffNoBody = { Authorization: 'Bearer staff' }
  const userNoBody = { Authorization: 'Bearer user' }

  it('POST /:id/custom-domain/challenge staff', async () => {
    service.issueCustomDomainChallenge.mockResolvedValue({ recordType: 'TXT', recordValue: 'apphub-verify=x' })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/custom-domain/challenge', headers: staffNoBody })
    expect(res.statusCode).toBe(200)
    expect(service.issueCustomDomainChallenge).toHaveBeenCalledWith('t1', expect.anything())
  })

  it('POST /:id/custom-domain/verify staff', async () => {
    service.verifyCustomDomain.mockResolvedValue({ verified: true })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/custom-domain/verify', headers: staffNoBody })
    expect(res.statusCode).toBe(200)
    expect(res.json().verified).toBe(true)
  })

  it('challenge user → 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/custom-domain/challenge', headers: userNoBody })
    expect(res.statusCode).toBe(403)
  })
})

describe('defaults defensivos (actor ?? null, body ?? {}) — handlers directos', () => {
  // Recorder fake-fastify para invocar handlers con req.identity / req.body
  // / req.ip ausentes y ejercitar las ramas `?? null` / `?? {}`.
  async function handlers() {
    const routes = []
    const push = (m) => (p, o, h) => routes.push({ m, p, h: h ?? o })
    await tenantsRoutes({
      get: push('get'), post: push('post'), patch: push('patch'), put: push('put'), delete: push('delete'),
    })
    return routes
  }
  const find = (rs, m, p) => rs.find((r) => r.m === m && r.p === p)

  it('POST /v1/tenants sin identity ni ip → actor {null,null,null}', async () => {
    service.createTenant.mockResolvedValue({ id: 't1' })
    const rs = await handlers()
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    await find(rs, 'post', '/v1/tenants').h({ body: { appId: 'aikikan', displayName: 'X', subdomain: 's', contactEmail: 'c@x.com' } }, reply)
    expect(service.createTenant).toHaveBeenCalledWith(expect.anything(), { userId: null, role: null, ip: null })
  })

  it('PATCH /v1/tenants/:id con identity parcial → role null', async () => {
    service.updateTenant.mockResolvedValue({ id: 't1' })
    const rs = await handlers()
    await find(rs, 'patch', '/v1/tenants/:id').h({ params: { id: 't1' }, body: { displayName: 'Y' }, identity: { userId: 'u9' }, ip: '1.2.3.4' })
    expect(service.updateTenant).toHaveBeenCalledWith('t1', expect.anything(), { userId: 'u9', role: null, ip: '1.2.3.4' })
  })

  it('POST /v1/tenants/:id/subscribe con body undefined → subscribeBody.parse(req.body ?? {}) → lanza (returnUrl requerido)', async () => {
    const rs = await handlers()
    await expect(
      find(rs, 'post', '/v1/tenants/:id/subscribe').h({ params: { id: 't1' }, headers: {}, identity: null }),
    ).rejects.toBeTruthy()
  })
})
