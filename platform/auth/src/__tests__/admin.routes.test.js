// admin.routes — oauth-providers config (super_admin|staff). Mockea el repo
// y el pool; verifica gate de role, validación de provider y delegación.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { poolConnectMock, mockClient } = vi.hoisted(() => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
  return { mockClient: client, poolConnectMock: vi.fn().mockResolvedValue(client) }
})
vi.mock('../lib/db.js', () => ({ pool: { connect: poolConnectMock } }))

vi.mock('../repositories/oauth-providers.repository.js', () => ({
  listProviders: vi.fn(),
  upsertProvider: vi.fn(),
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
import * as repo from '../repositories/oauth-providers.repository.js'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(adminRoutes, { prefix: '/v1/auth/admin' })
  await app.ready()
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  mockClient.query.mockResolvedValue({ rows: [] })
  poolConnectMock.mockResolvedValue(mockClient)
  app = await buildApp()
})
afterEach(async () => { await app.close() })

const staff = { Authorization: 'Bearer staff-token' }
const user  = { Authorization: 'Bearer user-token' }

describe('GET /oauth-providers', () => {
  it('user → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/admin/oauth-providers', headers: user })
    expect(res.statusCode).toBe(403)
  })

  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/admin/oauth-providers' })
    expect(res.statusCode).toBe(401)
  })

  it('staff → lista providers; libera client', async () => {
    repo.listProviders.mockResolvedValue([{ provider: 'google' }])
    const res = await app.inject({ method: 'GET', url: '/v1/auth/admin/oauth-providers', headers: staff })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ provider: 'google' }])
    expect(mockClient.release).toHaveBeenCalled()
  })
})

describe('PATCH /oauth-providers/:provider', () => {
  it('provider desconocido → 400', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/auth/admin/oauth-providers/twitter',
      headers: { ...staff, 'Content-Type': 'application/json' }, payload: { enabled: true },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_PROVIDER')
  })

  it('staff actualiza google; devuelve el provider', async () => {
    repo.upsertProvider.mockResolvedValue({})
    repo.listProviders.mockResolvedValue([
      { provider: 'google', enabled: true }, { provider: 'facebook', enabled: false },
    ])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/auth/admin/oauth-providers/google',
      headers: { ...staff, 'Content-Type': 'application/json' },
      payload: { clientId: 'gid', clientSecret: 'sec', enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ provider: 'google', enabled: true })
    expect(repo.upsertProvider).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'google', clientId: 'gid', updatedByUserId: 'u1' }),
    )
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('user → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/auth/admin/oauth-providers/google',
      headers: { ...user, 'Content-Type': 'application/json' }, payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
  })

  it('body vacío → usa default {}', async () => {
    repo.upsertProvider.mockResolvedValue({})
    repo.listProviders.mockResolvedValue([{ provider: 'facebook' }])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/auth/admin/oauth-providers/facebook', headers: staff,
    })
    expect(res.statusCode).toBe(200)
  })
})
