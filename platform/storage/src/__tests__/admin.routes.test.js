// admin.routes — config S3 staff-only (platform_storage.settings).
// Valida role gating (requireRole super_admin/staff), GET /config (listForAdmin),
// PATCH /config (upsert por campo + invalidación de cache/cliente), normalización
// de s3_force_path_style a string, y GET /kinds (catálogo code-defined).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const { release, connect, listForAdmin, upsertValue, loadSettings, invalidate, configureClient } = vi.hoisted(() => {
  const release = vi.fn()
  return {
    release,
    connect: vi.fn(async () => ({ release })),
    listForAdmin: vi.fn(),
    upsertValue: vi.fn(),
    loadSettings: vi.fn(),
    invalidate: vi.fn(),
    configureClient: vi.fn(),
  }
})
vi.mock('../lib/db.js', () => ({ pool: { connect } }))
vi.mock('../repositories/settings.repository.js', () => ({
  listForAdmin: (...a) => listForAdmin(...a),
  upsertValue: (...a) => upsertValue(...a),
}))
vi.mock('../lib/settings.js', () => ({
  loadSettings: (...a) => loadSettings(...a),
  invalidate: (...a) => invalidate(...a),
}))
vi.mock('../services/storage.service.js', () => ({ configureClient: (...a) => configureClient(...a) }))

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
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(adminRoutes, { prefix: '/v1/storage/admin' })
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
    const res = await app.inject({ method: 'GET', url: '/v1/storage/admin/config' })
    expect(res.statusCode).toBe(401)
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /config', () => {
  it('staff → listForAdmin; libera el client', async () => {
    listForAdmin.mockResolvedValue([{ key: 's3_region', value: 'eu-west-1' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ key: 's3_region', value: 'eu-west-1' }])
    expect(release).toHaveBeenCalled()
  })

  it('super_admin también puede', async () => {
    listForAdmin.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer super-token' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('PATCH /config', () => {
  it('upserta cada campo presente, invalida cliente + cache y recarga', async () => {
    listForAdmin.mockResolvedValue([{ key: 's3_bucket', value: 'newbucket' }])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { s3_bucket: 'newbucket', s3_region: 'eu-west-1' },
    })
    expect(res.statusCode).toBe(200)
    expect(upsertValue).toHaveBeenCalledWith(expect.anything(), 's3_bucket', 'newbucket')
    expect(upsertValue).toHaveBeenCalledWith(expect.anything(), 's3_region', 'eu-west-1')
    expect(configureClient).toHaveBeenCalledWith(null)
    expect(invalidate).toHaveBeenCalled()
    expect(loadSettings).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })

  it('normaliza s3_force_path_style booleano a string', async () => {
    listForAdmin.mockResolvedValue([])
    await app.inject({
      method: 'PATCH', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { s3_force_path_style: true },
    })
    expect(upsertValue).toHaveBeenCalledWith(expect.anything(), 's3_force_path_style', 'true')
  })

  it('body vacío → no upserta nada pero invalida/recarga igualmente', async () => {
    listForAdmin.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(upsertValue).not.toHaveBeenCalled()
    expect(loadSettings).toHaveBeenCalled()
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/storage/admin/config',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: { s3_bucket: 'x' },
    })
    expect(res.statusCode).toBe(403)
    expect(upsertValue).not.toHaveBeenCalled()
  })
})

describe('GET /kinds', () => {
  it('devuelve el catálogo code-defined', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/storage/admin/kinds',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(Array.isArray(data)).toBe(true)
    const menu = data.find((k) => k.kind === 'menu_photo')
    expect(menu).toMatchObject({ kind: 'menu_photo', maxBytes: expect.any(Number) })
  })
})
