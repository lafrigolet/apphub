// devices.routes — registro de tokens push del usuario actual.
// Cubre POST (201), GET (list), DELETE (404 cuando no es del usuario / no
// existe, 204 cuando borra). withTenantTransaction es de 5 args.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const { withTenantTransaction } = vi.hoisted(() => ({ withTenantTransaction: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction }))
vi.mock('../repositories/push-devices.repository.js', () => ({
  upsertByToken: vi.fn(), listByUser: vi.fn(), findById: vi.fn(), deleteById: vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'user' }
      })
    }),
    requireRole: () => async () => {},
  }
})

import { devicesRoutes } from '../routes/devices.routes.js'
import * as repo from '../repositories/push-devices.repository.js'

async function buildApp() {
  const app = Fastify({ logger: false })
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
  await app.register(devicesRoutes, { prefix: '/v1/notifications/devices' })
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const H = { Authorization: 'Bearer u', 'Content-Type': 'application/json' }
const AUTH = { Authorization: 'Bearer u' }
beforeEach(async () => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
  app = await buildApp()
})
afterEach(async () => { await app.close() })

it('401 sin bearer', async () => {
  expect((await app.inject({ method: 'GET', url: '/v1/notifications/devices/' })).statusCode).toBe(401)
})

it('POST / registra device → 201', async () => {
  repo.upsertByToken.mockResolvedValue({ id: 'p1' })
  const res = await app.inject({
    method: 'POST', url: '/v1/notifications/devices/', headers: H,
    payload: { platform: 'ios', token: 'token-abcdefgh', label: 'iPhone' },
  })
  expect(res.statusCode).toBe(201)
  expect(res.json().data.id).toBe('p1')
  expect(repo.upsertByToken).toHaveBeenCalled()
})

it('GET / lista devices del usuario', async () => {
  repo.listByUser.mockResolvedValue([{ id: 'p1' }])
  const res = await app.inject({ method: 'GET', url: '/v1/notifications/devices/', headers: AUTH })
  expect(res.statusCode).toBe(200)
  expect(res.json().data).toEqual([{ id: 'p1' }])
})

describe('DELETE /:id', () => {
  const id = '11111111-1111-1111-1111-111111111111'

  it('204 cuando borra device propio', async () => {
    repo.findById.mockResolvedValue({ id, user_id: 'u1' })
    repo.deleteById.mockResolvedValue(true)
    const res = await app.inject({ method: 'DELETE', url: `/v1/notifications/devices/${id}`, headers: AUTH })
    expect(res.statusCode).toBe(204)
  })

  it('404 cuando el device no existe', async () => {
    repo.findById.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: `/v1/notifications/devices/${id}`, headers: AUTH })
    expect(res.statusCode).toBe(404)
    expect(repo.deleteById).not.toHaveBeenCalled()
  })

  it('404 cuando el device es de otro usuario', async () => {
    repo.findById.mockResolvedValue({ id, user_id: 'other' })
    const res = await app.inject({ method: 'DELETE', url: `/v1/notifications/devices/${id}`, headers: AUTH })
    expect(res.statusCode).toBe(404)
  })
})
