// sub-tenants.routes — CRUD staff-gated del segundo nivel de tenancy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../services/sub-tenants.service.js')

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        const auth = req.headers.authorization ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
        if (token) {
          const role = token === 'staff' ? 'staff' : token === 'super' ? 'super_admin' : 'user'
          req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role }
        }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    },
  }
})

import * as service from '../services/sub-tenants.service.js'
import { subTenantsRoutes } from '../routes/sub-tenants.routes.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) { const r = schema.safeParse(data); return r.success ? { value: r.data } : { error: r.error } }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(subTenantsRoutes)
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

describe('GET list/get', () => {
  it('GET lista', async () => {
    service.listSubTenants.mockResolvedValue([{ id: 's1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/t1/sub-tenants', headers: user })
    expect(res.statusCode).toBe(200)
    expect(service.listSubTenants).toHaveBeenCalledWith('t1')
  })
  it('GET single', async () => {
    service.getSubTenant.mockResolvedValue({ id: 's1' })
    const res = await app.inject({ method: 'GET', url: '/v1/tenants/t1/sub-tenants/s1', headers: user })
    expect(res.json().id).toBe('s1')
    expect(service.getSubTenant).toHaveBeenCalledWith('t1', 's1')
  })
})

describe('POST (staff)', () => {
  it('staff crea → 201', async () => {
    service.createSubTenant.mockResolvedValue({ id: 's1' })
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/sub-tenants', headers: staff, payload: { displayName: 'Norte', slug: 'norte' } })
    expect(res.statusCode).toBe(201)
    expect(service.createSubTenant).toHaveBeenCalledWith('t1', expect.objectContaining({ slug: 'norte' }), expect.objectContaining({ userId: 'u1' }))
  })
  it('user → 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/sub-tenants', headers: user, payload: { displayName: 'N', slug: 'n' } })
    expect(res.statusCode).toBe(403)
  })
  it('slug inválido (no kebab) → 4xx, no toca service', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tenants/t1/sub-tenants', headers: staff, payload: { displayName: 'N', slug: 'Mal Slug' } })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(service.createSubTenant).not.toHaveBeenCalled()
  })
})

describe('PATCH / DELETE (staff)', () => {
  it('PATCH actualiza', async () => {
    service.updateSubTenant.mockResolvedValue({ id: 's1', status: 'suspended' })
    const res = await app.inject({ method: 'PATCH', url: '/v1/tenants/t1/sub-tenants/s1', headers: staff, payload: { status: 'suspended' } })
    expect(res.statusCode).toBe(200)
    expect(service.updateSubTenant).toHaveBeenCalledWith('t1', 's1', { status: 'suspended' }, expect.anything())
  })
  it('DELETE borra', async () => {
    service.deleteSubTenant.mockResolvedValue({ id: 's1', deleted: true })
    const res = await app.inject({ method: 'DELETE', url: '/v1/tenants/t1/sub-tenants/s1', headers: { Authorization: 'Bearer staff' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().deleted).toBe(true)
  })
  it('DELETE user → 403', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/tenants/t1/sub-tenants/s1', headers: { Authorization: 'Bearer user' } })
    expect(res.statusCode).toBe(403)
  })
})
