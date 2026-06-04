import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/tenant-settings.service.js', () => ({
  getPublicSuggestedAmounts: vi.fn(),
  getSettings:               vi.fn(),
  updateSettings:            vi.fn(),
}))
vi.mock('../services/donors.service.js', () => ({
  listDonors:      vi.fn(),
  getDonor:        vi.fn(),
  exportDonorsCsv: vi.fn(),
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
        const token = auth.slice(7)
        const role = token === 'admin-token' ? 'admin' : 'user'
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role, email: 'x@x' }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { publicSettingsRoutes, adminSettingsRoutes } from '../routes/settings.routes.js'
import { adminDonorsRoutes }                          from '../routes/donors.routes.js'
import * as settingsService from '../services/tenant-settings.service.js'
import * as donorsService   from '../services/donors.service.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: new Error('VALIDATION') }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (data) => (typeof data === 'string' ? data : JSON.stringify(data)))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(publicSettingsRoutes, { prefix: '/v1/donations/settings' })
  await app.register(adminSettingsRoutes,  { prefix: '/v1/donations/settings/admin' })
  await app.register(adminDonorsRoutes,    { prefix: '/v1/donations/donors/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'ERROR', message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const TENANT = '30000000-0000-0000-0000-000000000001'

describe('GET /v1/donations/settings/suggested-amounts — público', () => {
  it('no requiere Bearer; devuelve los importes', async () => {
    settingsService.getPublicSuggestedAmounts.mockResolvedValue([1000, 2500])
    const res = await app.inject({
      method: 'GET',
      url: `/v1/donations/settings/suggested-amounts?appId=aikikan&tenantId=${TENANT}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { suggestedAmountsCents: [1000, 2500] } })
  })
})

describe('settings admin', () => {
  it('GET / rechaza al user (403)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/settings/admin',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
  it('PUT / admin OK', async () => {
    settingsService.updateSettings.mockResolvedValue({ default_suggested_amounts_cents: [1000] })
    const res = await app.inject({
      method: 'PUT', url: '/v1/donations/settings/admin',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      payload: { defaultSuggestedAmountsCents: [1000] },
    })
    expect(res.statusCode).toBe(200)
    expect(settingsService.updateSettings).toHaveBeenCalled()
  })
})

describe('donors admin', () => {
  it('GET / rechaza al user (403)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/donors/admin',
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(res.statusCode).toBe(403)
  })
  it('GET / admin lista donantes', async () => {
    donorsService.listDonors.mockResolvedValue([{ donor_key: 'x@x' }])
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/donors/admin',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ donor_key: 'x@x' }] })
  })
  it('GET /export.csv devuelve text/csv con headers', async () => {
    donorsService.exportDonorsCsv.mockResolvedValue({ filename: 'donantes_2026-06-04.csv', csv: 'a,b\r\n', count: 0 })
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/donors/admin/export.csv',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/donantes_2026-06-04\.csv/)
    expect(res.headers['x-donors-count']).toBe('0')
  })
  it('GET /:donorKey devuelve la ficha', async () => {
    donorsService.getDonor.mockResolvedValue({ donor_key: 'a@b', donations: [] })
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/donors/admin/a%40b',
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(donorsService.getDonor).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), 'a@b')
  })
})
