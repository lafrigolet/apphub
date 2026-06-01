// admin.routes — credenciales de video-proveedor staff-only.
// Valida role gating (requireRole super_admin/staff), GET /config (listForAdmin),
// PATCH /config (upsert por campo presente) y liberación del client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const { release, connect, listForAdmin, upsertValue } = vi.hoisted(() => {
  const release = vi.fn()
  return {
    release,
    connect: vi.fn(async () => ({ release })),
    listForAdmin: vi.fn(),
    upsertValue: vi.fn(),
  }
})
vi.mock('../lib/db.js', () => ({ pool: { connect } }))
vi.mock('../repositories/settings.repository.js', () => ({
  listForAdmin: (...a) => listForAdmin(...a),
  upsertValue: (...a) => upsertValue(...a),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        const token = auth.slice(7)
        const role = token === 'staff-token' ? 'staff'
          : token === 'super-token' ? 'super_admin' : 'user'
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
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(adminRoutes, { prefix: '/v1/telehealth/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('role gating', () => {
  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/telehealth/admin/config' })
    expect(res.statusCode).toBe(401)
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/telehealth/admin/config',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /config', () => {
  it('staff → listForAdmin; libera el client', async () => {
    listForAdmin.mockResolvedValue([{ key: 'active_provider', value: 'daily' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/telehealth/admin/config',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ key: 'active_provider', value: 'daily' }])
    expect(release).toHaveBeenCalled()
  })

  it('super_admin también puede', async () => {
    listForAdmin.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/telehealth/admin/config',
      headers: { Authorization: 'Bearer super-token' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('PATCH /config', () => {
  it('upserta cada campo presente y devuelve listForAdmin', async () => {
    listForAdmin.mockResolvedValue([{ key: 'active_provider', value: 'daily' }])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/telehealth/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { active_provider: 'daily', daily_api_key: 'AK', daily_domain: 'd.daily.co' },
    })
    expect(res.statusCode).toBe(200)
    expect(upsertValue).toHaveBeenCalledWith(expect.anything(), 'active_provider', 'daily')
    expect(upsertValue).toHaveBeenCalledWith(expect.anything(), 'daily_api_key', 'AK')
    expect(upsertValue).toHaveBeenCalledWith(expect.anything(), 'daily_domain', 'd.daily.co')
    expect(release).toHaveBeenCalled()
  })

  it('body vacío → no upserta pero devuelve config', async () => {
    listForAdmin.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/telehealth/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(upsertValue).not.toHaveBeenCalled()
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/telehealth/admin/config',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { active_provider: 'daily' },
    })
    expect(res.statusCode).toBe(403)
    expect(upsertValue).not.toHaveBeenCalled()
  })
})
