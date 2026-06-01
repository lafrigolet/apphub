// admin.routes — config de carriers (GET/PATCH), gate de rol super_admin/staff.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const poolClient = { query: vi.fn(), release: vi.fn() }
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn(async () => poolClient) } }))
vi.mock('../repositories/settings.repository.js', () => ({
  listForAdmin: vi.fn(),
  upsertValue:  vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', () => ({
  requireRole: (...roles) => async (req, reply) => {
    if (!req.identity?.role || !roles.includes(req.identity.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    }
  },
}))

import { adminRoutes } from '../routes/admin.routes.js'
import * as repo from '../repositories/settings.repository.js'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => {
    const tok = (req.headers.authorization ?? '').slice(7)
    const role = tok === 'staff' ? 'staff' : tok === 'super' ? 'super_admin' : 'user'
    req.identity = { appId: 'shop', tenantId: 't1', role }
  })
  await app.register(adminRoutes, { prefix: '/v1/shipping/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  poolClient.query.mockReset()
  poolClient.release.mockReset()
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('GET /config', () => {
  it('user normal → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/shipping/admin/config', headers: { Authorization: 'Bearer user' } })
    expect(res.statusCode).toBe(403)
    expect(repo.listForAdmin).not.toHaveBeenCalled()
  })
  it('staff → 200 { data }, libera client', async () => {
    repo.listForAdmin.mockResolvedValue([{ key: 'ups_enabled', value: 'true' }])
    const res = await app.inject({ method: 'GET', url: '/v1/shipping/admin/config', headers: { Authorization: 'Bearer staff' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ key: 'ups_enabled', value: 'true' }])
    expect(poolClient.release).toHaveBeenCalled()
  })
})

describe('PATCH /config', () => {
  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/shipping/admin/config',
      headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' },
      payload: { ups_enabled: true },
    })
    expect(res.statusCode).toBe(403)
  })

  it('super_admin upsert: bool key → "true"/"false", string key tal cual', async () => {
    repo.listForAdmin.mockResolvedValue([])
    repo.upsertValue.mockResolvedValue()
    const res = await app.inject({
      method: 'PATCH', url: '/v1/shipping/admin/config',
      headers: { Authorization: 'Bearer super', 'Content-Type': 'application/json' },
      payload: { ups_enabled: true, ups_environment: 'sandbox', fedex_enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const calls = Object.fromEntries(repo.upsertValue.mock.calls.map((c) => [c[1], c[2]]))
    expect(calls.ups_enabled).toBe('true')
    expect(calls.fedex_enabled).toBe('false')
    expect(calls.ups_environment).toBe('sandbox')
    expect(poolClient.release).toHaveBeenCalled()
  })

  it('valores undefined se saltan (no llama upsert)', async () => {
    repo.listForAdmin.mockResolvedValue([])
    repo.upsertValue.mockResolvedValue()
    await app.inject({
      method: 'PATCH', url: '/v1/shipping/admin/config',
      headers: { Authorization: 'Bearer super', 'Content-Type': 'application/json' },
      payload: { ups_account_number: 'A123' },
    })
    expect(repo.upsertValue).toHaveBeenCalledTimes(1)
    expect(repo.upsertValue).toHaveBeenCalledWith(poolClient, 'ups_account_number', 'A123')
  })
})

// Rama `req.body ?? {}`: fastify valida el schema-body antes del handler, así
// que la invocamos directamente con req.body undefined.
describe('PATCH /config — default `?? {}` (handler directo)', () => {
  it('req.body undefined → patchBody.parse({}) → 0 upserts, libera client', async () => {
    const routes = []
    await adminRoutes({
      addHook: () => {},
      get:   (p, o, h) => routes.push({ m: 'get', p, h: h ?? o }),
      patch: (p, o, h) => routes.push({ m: 'patch', p, h: h ?? o }),
    })
    repo.listForAdmin.mockResolvedValue([])
    const patch = routes.find((r) => r.m === 'patch')
    const out = await patch.h({})   // sin body
    expect(out).toEqual({ data: [] })
    expect(repo.upsertValue).not.toHaveBeenCalled()
    expect(poolClient.release).toHaveBeenCalled()
  })
})
