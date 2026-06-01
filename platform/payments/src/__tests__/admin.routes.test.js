// admin.routes — surface admin del módulo payments (config Stripe).
// Cubre el role gate (requireRole super_admin/staff), GET /config y
// PATCH /config (upsert por key, ignorando undefined), y la liberación
// del client del pool en finally.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const { release, connect } = vi.hoisted(() => ({ release: vi.fn(), connect: vi.fn() }))

vi.mock('../lib/db.js', () => ({
  pool: { connect },
}))

vi.mock('../repositories/config.repository.js', () => ({
  listConfig:  vi.fn(),
  upsertValue: vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        const token = auth.slice(7)
        const role = token === 'staff-token' ? 'staff'
                  : token === 'super-token' ? 'super_admin'
                  : 'user'
        req.identity = { userId: 'u1', appId: 'platform', tenantId: 't1', role }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { adminRoutes } from '../routes/admin.routes.js'
import * as repo from '../repositories/config.repository.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(adminRoutes, { prefix: '/v1/payments/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  connect.mockResolvedValue({ release })
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('role gate', () => {
  it('401 sin Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/payments/admin/config' })
    expect(res.statusCode).toBe(401)
  })

  it('403 para user normal', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(repo.listConfig).not.toHaveBeenCalled()
  })
})

describe('GET /config', () => {
  it('staff obtiene el listado y libera el client', async () => {
    repo.listConfig.mockResolvedValue([{ key: 'stripe_secret_key', configured: true }])
    const res = await app.inject({
      method: 'GET', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].key).toBe('stripe_secret_key')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('super_admin también accede', async () => {
    repo.listConfig.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer super-token' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('libera el client aunque el repo lance (finally)', async () => {
    repo.listConfig.mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'GET', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(500)
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /config', () => {
  it('upsert solo de las keys presentes; ignora undefined', async () => {
    repo.listConfig.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { stripe_secret_key: 'sk_test_1', stripe_publishable_key: 'pk_1' },
    })
    expect(res.statusCode).toBe(200)
    expect(repo.upsertValue).toHaveBeenCalledTimes(2)
    expect(repo.upsertValue).toHaveBeenCalledWith(expect.anything(), 'stripe_secret_key', 'sk_test_1', 'u1')
    expect(repo.upsertValue).toHaveBeenCalledWith(expect.anything(), 'stripe_publishable_key', 'pk_1', 'u1')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('body vacío → no upsert, devuelve listConfig', async () => {
    repo.listConfig.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(repo.upsertValue).not.toHaveBeenCalled()
  })

  it('valor explícito null se aplica (limpiar key)', async () => {
    repo.listConfig.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { stripe_webhook_secret: null },
    })
    expect(res.statusCode).toBe(200)
    expect(repo.upsertValue).toHaveBeenCalledWith(expect.anything(), 'stripe_webhook_secret', null, 'u1')
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/payments/admin/config',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { stripe_secret_key: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('defaults defensivos (?? {}) — handlers directos', () => {
  async function handlers() {
    const routes = []
    await adminRoutes({
      addHook: () => {},
      get:   (p, h) => routes.push({ m: 'get', p, h }),
      patch: (p, h) => routes.push({ m: 'patch', p, h }),
    })
    return routes
  }

  it('PATCH /config con req.body undefined → patchBody.parse(req.body ?? {}) → {} válido, sin upsert', async () => {
    repo.listConfig.mockResolvedValue([])
    const routes = await handlers()
    const patch = routes.find((r) => r.m === 'patch')
    // req.body undefined → ?? {} ; req.identity undefined → ?? undefined userId
    const out = await patch.h({ headers: {} })
    expect(out.data).toEqual([])
    expect(repo.upsertValue).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('PATCH /config con identity undefined → upsert con userId undefined', async () => {
    repo.listConfig.mockResolvedValue([])
    const routes = await handlers()
    const patch = routes.find((r) => r.m === 'patch')
    await patch.h({ body: { stripe_secret_key: 'sk_x' } })
    expect(repo.upsertValue).toHaveBeenCalledWith(expect.anything(), 'stripe_secret_key', 'sk_x', undefined)
  })
})
