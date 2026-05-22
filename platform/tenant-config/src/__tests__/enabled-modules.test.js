// enabled-modules — el array que dictamina qué manifests monta tenant-console.
// Contrato:
//   - PUT /v1/apps/:appId/enabled-modules con body { modules: string[] }.
//   - zod schema: cada elemento string min 1 max 64; array max 32 elementos.
//   - El reemplazo es TOTAL (REPLACE, no patch): array vacío deshabilita todo.
//   - 404 si el appId no existe (delegado al service).
//   - Otros endpoints (status, splitpay) son independientes del enabled-modules.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
  },
}))
vi.mock('../services/apps.service.js')
import * as appsService from '../services/apps.service.js'
import { appsRoutes } from '../routes/apps.routes.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(appsRoutes)
  return app
}

beforeEach(() => vi.clearAllMocks())

// ── PUT enabled-modules — happy ─────────────────────────────────────

describe('PUT /v1/apps/:appId/enabled-modules', () => {
  it('happy: pasa el array a setAppEnabledModules', async () => {
    appsService.setAppEnabledModules.mockResolvedValue({ app_id: 'aikikan', enabled_modules: ['leads'] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: ['leads'] },
    })
    expect(res.statusCode).toBe(200)
    expect(appsService.setAppEnabledModules).toHaveBeenCalledWith('aikikan', ['leads'])
  })

  it('array vacío permitido (deshabilita todos los manifests)', async () => {
    appsService.setAppEnabledModules.mockResolvedValue({ app_id: 'aikikan', enabled_modules: [] })
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(appsService.setAppEnabledModules).toHaveBeenCalledWith('aikikan', [])
  })

  it('múltiples módulos (orden preservado)', async () => {
    appsService.setAppEnabledModules.mockResolvedValue({})
    const app = await buildApp()
    await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: ['leads', 'donations', 'storage'] },
    })
    expect(appsService.setAppEnabledModules).toHaveBeenCalledWith('aikikan', ['leads', 'donations', 'storage'])
  })
})

// ── Validación zod ──────────────────────────────────────────────────

describe('validación zod', () => {
  it('modules NO array → 500 (zod throw)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: 'leads' },
    })
    expect(res.statusCode).toBe(500)
    expect(appsService.setAppEnabledModules).not.toHaveBeenCalled()
  })

  it('elemento "" (string vacío) → rechazo', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: ['leads', ''] },
    })
    expect(res.statusCode).toBe(500)
    expect(appsService.setAppEnabledModules).not.toHaveBeenCalled()
  })

  it('elemento > 64 chars → rechazo', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: ['x'.repeat(65)] },
    })
    expect(res.statusCode).toBe(500)
  })

  it('> 32 módulos → rechazo (cap defensivo)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: { modules: Array.from({ length: 33 }, (_, i) => `m${i}`) },
    })
    expect(res.statusCode).toBe(500)
  })

  it('body sin modules key → rechazo', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/aikikan/enabled-modules',
      payload: {},
    })
    expect(res.statusCode).toBe(500)
  })
})

// ── 404 propagado del service ───────────────────────────────────────

describe('app inexistente', () => {
  it('service NotFoundError 404 → respuesta 404', async () => {
    appsService.setAppEnabledModules.mockRejectedValue(
      Object.assign(new Error('App not found'), { statusCode: 404 }),
    )
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/v1/apps/ghost/enabled-modules',
      payload: { modules: ['leads'] },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── Otros endpoints siguen funcionando ──────────────────────────────

describe('apps.routes — otros endpoints independientes', () => {
  it('GET /v1/apps → listApps', async () => {
    appsService.listApps.mockResolvedValue([{ app_id: 'aikikan' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/apps' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('POST /v1/apps → 201 con la app creada', async () => {
    appsService.createApp.mockResolvedValue({ id: 'app-uuid', app_id: 'new' })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/apps',
      payload: {
        appId: 'new', displayName: 'New App', subdomain: 'new', jwtAudience: 'apphub',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('app-uuid')
  })

  it('PATCH /v1/apps/:id/status valida enum (active/suspended)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/aikikan/status',
      payload: { status: 'banana' },
    })
    expect(res.statusCode).toBe(500)
  })
})
