// admin.routes — config S3 staff-only (platform_storage.settings).
// Valida role gating (requireRole super_admin/staff), GET /config (listForAdmin),
// PATCH /config (upsert por campo + invalidación de cache/cliente), normalización
// de s3_force_path_style a string, y GET /kinds (catálogo code-defined).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const { release, connect, listForAdmin, upsertValue, loadSettings, invalidate, configureClient, testConnectivity, setQuota, getUsage, listAccessLog, purgeExpired, notifyExpiringSoon } = vi.hoisted(() => {
  const release = vi.fn()
  return {
    release,
    connect: vi.fn(async () => ({ release })),
    listForAdmin: vi.fn(),
    upsertValue: vi.fn(),
    loadSettings: vi.fn(),
    invalidate: vi.fn(),
    configureClient: vi.fn(),
    testConnectivity: vi.fn(async () => ({ ok: true, bucket: 'apphub' })),
    setQuota: vi.fn(),
    getUsage: vi.fn(),
    listAccessLog: vi.fn(),
    purgeExpired: vi.fn(),
    notifyExpiringSoon: vi.fn(),
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
vi.mock('../services/storage.service.js', () => ({
  configureClient: (...a) => configureClient(...a),
  testConnectivity: (...a) => testConnectivity(...a),
  setQuota: (...a) => setQuota(...a),
  getUsage: (...a) => getUsage(...a),
  listAccessLog: (...a) => listAccessLog(...a),
  purgeExpired: (...a) => purgeExpired(...a),
  notifyExpiringSoon: (...a) => notifyExpiringSoon(...a),
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

describe('GET /access-log', () => {
  it('staff → listAccessLog con filtros parseados', async () => {
    listAccessLog.mockResolvedValue({ items: [{ id: 'a1' }], nextCursor: null })
    const res = await app.inject({
      method: 'GET',
      url: '/v1/storage/admin/access-log?objectId=22222222-2222-2222-2222-222222222222&limit=10',
      headers: { Authorization: 'Bearer staff-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([{ id: 'a1' }])
    expect(listAccessLog).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'platform', tenantId: 't1' }),
      expect.objectContaining({ objectId: '22222222-2222-2222-2222-222222222222', limit: 10 }),
    )
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/storage/admin/access-log',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(listAccessLog).not.toHaveBeenCalled()
  })
})

describe('POST /retention/purge', () => {
  it('staff → purgeExpired con limit', async () => {
    purgeExpired.mockResolvedValue({ purged: 2, objectIds: ['o1', 'o2'] })
    const res = await app.inject({
      method: 'POST', url: '/v1/storage/admin/retention/purge',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { limit: 100 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ purged: 2, objectIds: ['o1', 'o2'] })
    expect(purgeExpired).toHaveBeenCalledWith(expect.anything(), { limit: 100 })
  })

  it('sin body → limit por defecto 500', async () => {
    purgeExpired.mockResolvedValue({ purged: 0, objectIds: [] })
    await app.inject({
      method: 'POST', url: '/v1/storage/admin/retention/purge',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(purgeExpired).toHaveBeenCalledWith(expect.anything(), { limit: 500 })
  })

  it('user normal → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/storage/admin/retention/purge',
      headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(purgeExpired).not.toHaveBeenCalled()
  })
})

describe('POST /retention/notify-expiring', () => {
  it('staff → notifyExpiringSoon con windowDays', async () => {
    notifyExpiringSoon.mockResolvedValue({ notified: 3, objectIds: ['a', 'b', 'c'] })
    const res = await app.inject({
      method: 'POST', url: '/v1/storage/admin/retention/notify-expiring',
      headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' },
      payload: { windowDays: 7 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().notified).toBe(3)
    expect(notifyExpiringSoon).toHaveBeenCalledWith(expect.anything(), { windowDays: 7, limit: 1000 })
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
