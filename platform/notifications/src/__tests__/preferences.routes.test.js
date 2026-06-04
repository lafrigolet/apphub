// preferences.routes — self-service opt-out + public token unsubscribe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { withTenantTransaction } = vi.hoisted(() => ({ withTenantTransaction: vi.fn() }))
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(client) },
  withTenantTransaction,
}))
vi.mock('../repositories/preferences.repository.js', () => ({
  listForUser: vi.fn(), setPreference: vi.fn(), upsertToken: vi.fn(),
  findByToken: vi.fn(), muteByScope: vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'user' }
      })
    }),
    requireRole: () => async () => {},
  }
})

import { preferencesRoutes } from '../routes/preferences.routes.js'
import * as repo from '../repositories/preferences.repository.js'

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
  await app.register(preferencesRoutes, { prefix: '/v1/notifications' })
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
const JSON_H = { 'Content-Type': 'application/json' }

beforeEach(async () => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
  app = await buildApp()
})
afterEach(async () => { await app.close() })

it('GET /preferences requires auth (401)', async () => {
  expect((await app.inject({ method: 'GET', url: '/v1/notifications/preferences' })).statusCode).toBe(401)
})

it('GET /preferences lists muted prefs + categories', async () => {
  repo.listForUser.mockResolvedValue([{ category: 'orders', channel: '*', muted: true }])
  const res = await app.inject({ method: 'GET', url: '/v1/notifications/preferences', headers: H })
  expect(res.statusCode).toBe(200)
  expect(res.json().data.muted).toHaveLength(1)
  expect(res.json().data.categories).toContain('orders')
})

it('PATCH /preferences mutes a category', async () => {
  repo.setPreference.mockResolvedValue({ category: 'marketing', channel: '*', muted: true })
  const res = await app.inject({
    method: 'PATCH', url: '/v1/notifications/preferences', headers: H,
    payload: { category: 'marketing', channel: '*', muted: true },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().data.muted).toBe(true)
  expect(repo.setPreference).toHaveBeenCalled()
})

it('PATCH /preferences rejects a non-mutable category (validation)', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/v1/notifications/preferences', headers: H,
    payload: { category: 'auth', muted: true },
  })
  // 'auth' is not in MUTABLE_CATEGORIES → schema rejects it before the handler.
  expect([400, 422]).toContain(res.statusCode)
  expect(repo.setPreference).not.toHaveBeenCalled()
})

it('GET /preferences/unsubscribe-token returns a token', async () => {
  repo.upsertToken.mockResolvedValue('tok-xyz')
  const res = await app.inject({ method: 'GET', url: '/v1/notifications/preferences/unsubscribe-token', headers: H })
  expect(res.statusCode).toBe(200)
  expect(res.json().data.token).toBe('tok-xyz')
})

describe('POST /unsubscribe (public)', () => {
  it('works without auth and mutes the resolved user', async () => {
    repo.findByToken.mockResolvedValue({ token: 't', app_id: 'a', tenant_id: 'tn', user_id: 'u9' })
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/unsubscribe', headers: JSON_H,
      payload: { token: 'tok-abcdef', category: 'marketing' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.unsubscribed).toBe(true)
    expect(repo.muteByScope).toHaveBeenCalledWith(client, expect.objectContaining({ userId: 'u9', category: 'marketing', channel: '*' }))
  })

  it('defaults category to marketing', async () => {
    repo.findByToken.mockResolvedValue({ token: 't', app_id: 'a', tenant_id: 'tn', user_id: 'u9' })
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/unsubscribe', headers: JSON_H,
      payload: { token: 'tok-abcdef' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.category).toBe('marketing')
  })

  it('404 for unknown token', async () => {
    repo.findByToken.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/unsubscribe', headers: JSON_H,
      payload: { token: 'nope-1234' },
    })
    expect(res.statusCode).toBe(404)
  })
})
