// admin.routes — config de credenciales de carriers, role-gated
// (super_admin/staff), GET/PATCH con normalización booleana + skip de
// undefined.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('@apphub/platform-sdk/app-guard', () => ({
  requireRole: (...roles) => async (req, reply) => {
    if (!req.identity?.role || !roles.includes(req.identity.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    }
  },
}))

const mockClient = { release: vi.fn() }
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn(async () => mockClient) },
}))

vi.mock('../repositories/settings.repository.js', () => ({
  listForAdmin: vi.fn(),
  upsertValue:  vi.fn(),
}))

import { adminRoutes } from '../routes/admin.routes.js'
import * as repo from '../repositories/settings.repository.js'
import { pool } from '../lib/db.js'

let identity = { appId: 'aikikan', tenantId: 't1', userId: 'u1', role: 'staff' }

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
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = identity })
  await app.register(adminRoutes)
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
  identity = { appId: 'aikikan', tenantId: 't1', userId: 'u1', role: 'staff' }
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('GET /config — role gate', () => {
  it('staff lista config y libera el cliente', async () => {
    repo.listForAdmin.mockResolvedValue([{ key: 'uber_enabled', value: 'true' }])
    const res = await app.inject({ method: 'GET', url: '/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ key: 'uber_enabled', value: 'true' }])
    expect(pool.connect).toHaveBeenCalled()
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('user normal → 403', async () => {
    identity = { ...identity, role: 'user' }
    const res = await app.inject({ method: 'GET', url: '/config' })
    expect(res.statusCode).toBe(403)
    expect(repo.listForAdmin).not.toHaveBeenCalled()
  })
})

describe('PATCH /config', () => {
  it('upsertea cada clave; normaliza booleanos a string', async () => {
    repo.listForAdmin.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/config',
      payload: { uber_enabled: true, uber_environment: 'production', uber_client_secret: 'shh' },
    })
    expect(res.statusCode).toBe(200)
    expect(repo.upsertValue).toHaveBeenCalledWith(mockClient, 'uber_enabled', 'true')
    expect(repo.upsertValue).toHaveBeenCalledWith(mockClient, 'uber_environment', 'production')
    expect(repo.upsertValue).toHaveBeenCalledWith(mockClient, 'uber_client_secret', 'shh')
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('ignora claves con valor undefined (no enviadas)', async () => {
    repo.listForAdmin.mockResolvedValue([])
    const res = await app.inject({ method: 'PATCH', url: '/config', payload: {} })
    expect(res.statusCode).toBe(200)
    expect(repo.upsertValue).not.toHaveBeenCalled()
  })

  it('booleano falsy → "false"', async () => {
    repo.listForAdmin.mockResolvedValue([])
    await app.inject({ method: 'PATCH', url: '/config', payload: { glovo_enabled: false } })
    expect(repo.upsertValue).toHaveBeenCalledWith(mockClient, 'glovo_enabled', 'false')
  })

  it('user normal → 403', async () => {
    identity = { ...identity, role: 'user' }
    const res = await app.inject({ method: 'PATCH', url: '/config', payload: { uber_enabled: true } })
    expect(res.statusCode).toBe(403)
    expect(repo.upsertValue).not.toHaveBeenCalled()
  })
})
