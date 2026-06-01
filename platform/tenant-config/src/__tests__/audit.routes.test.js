// audit.routes — GET /v1/audit delega en el service con identity para scoping.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../services/audit.service.js')

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role: 'staff' }
      })
    }),
    requireRole: () => async () => {},
  }
})

import * as service from '../services/audit.service.js'
import { auditRoutes } from '../routes/audit.routes.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) { const r = schema.safeParse(data); return r.success ? { value: r.data } : { error: r.error } }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(auditRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

it('GET /v1/audit parsea query y pasa identity', async () => {
  service.listAudit.mockResolvedValue([{ id: 'a1' }])
  const res = await app.inject({ method: 'GET', url: '/v1/audit?appId=aikikan&limit=10' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual([{ id: 'a1' }])
  expect(service.listAudit).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'aikikan', limit: 10 }),
    expect.objectContaining({ role: 'staff' }),
  )
})

it('GET /v1/audit sin filtros', async () => {
  service.listAudit.mockResolvedValue([])
  const res = await app.inject({ method: 'GET', url: '/v1/audit' })
  expect(res.statusCode).toBe(200)
})
