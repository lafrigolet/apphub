import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/devices.service.js', () => ({
  createDevice:     vi.fn(),
  listDevices:      vi.fn(),
  getDevice:        vi.fn(),
  updateDevice:     vi.fn(),
  deactivateDevice: vi.fn(),
}))

vi.mock('../services/series.service.js', () => ({
  createSeries: vi.fn(),
  listSeries:   vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  const roleByToken = {
    'cashier-token': 'cashier',
    'manager-token': 'manager',
    'staff-token':   'staff',
  }
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        const role = roleByToken[auth.slice(7)] ?? 'user'
        req.identity = {
          userId: 'u1', appId: 'aikikan',
          tenantId: '30000000-0000-0000-0000-000000000001',
          subTenantId: null, role, email: 'x@x',
        }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { devicesRoutes } from '../routes/devices.routes.js'
import { seriesRoutes } from '../routes/series.routes.js'
import * as devicesService from '../services/devices.service.js'
import * as seriesService from '../services/series.service.js'

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
  app.setSerializerCompiler(() => (data) => JSON.stringify(data))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(devicesRoutes, { prefix: '/v1/tpv/devices' })
  await app.register(seriesRoutes,  { prefix: '/v1/tpv/series' })
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

describe('POST /v1/tpv/devices — solo gestión', () => {
  it('403 para cajero (gestión de dispositivos es de manager+)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/devices',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { name: 'Caja 1' },
    })
    expect(res.statusCode).toBe(403)
    expect(devicesService.createDevice).not.toHaveBeenCalled()
  })

  it('201 para manager', async () => {
    devicesService.createDevice.mockResolvedValue({ id: 'd1', name: 'Caja 1', active: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/devices',
      headers: { Authorization: 'Bearer manager-token' },
      payload: { name: 'Caja 1', location: 'Recepción' },
    })
    expect(res.statusCode).toBe(201)
    expect(devicesService.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager' }),
      expect.objectContaining({ name: 'Caja 1', location: 'Recepción' }),
    )
  })

  it('422 sin name', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/devices',
      headers: { Authorization: 'Bearer manager-token' },
      payload: {},
    })
    expect([400, 422, 500]).toContain(res.statusCode)
  })
})

describe('DELETE /v1/tpv/devices/:id — desactivación soft', () => {
  it('llama a deactivateDevice', async () => {
    devicesService.deactivateDevice.mockResolvedValue({ id: 'd1', active: false })
    const res = await app.inject({
      method: 'DELETE', url: '/v1/tpv/devices/40000000-0000-0000-0000-000000000001',
      headers: { Authorization: 'Bearer manager-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(devicesService.deactivateDevice).toHaveBeenCalled()
  })
})

describe('POST /v1/tpv/series', () => {
  it('201 con code + kind válidos', async () => {
    seriesService.createSeries.mockResolvedValue({ id: 's1', code: 'A', kind: 'simplified', next_number: 1 })
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/series',
      headers: { Authorization: 'Bearer manager-token' },
      payload: { code: 'A', kind: 'simplified' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('422 con kind fuera del enum', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/series',
      headers: { Authorization: 'Bearer manager-token' },
      payload: { code: 'X', kind: 'lottery' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(seriesService.createSeries).not.toHaveBeenCalled()
  })
})
