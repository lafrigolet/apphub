// createApp — composition root. health, notFound, errorHandler (3 ramas).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@apphub/platform-sdk/app-guard', () => ({
  appGuard: async () => {},
  requireRole: () => async () => {},
}))
vi.mock('../routes/apps.routes.js', () => ({ appsRoutes: async () => {} }))
vi.mock('../routes/tenants.routes.js', () => ({ tenantsRoutes: async () => {} }))
vi.mock('../routes/audit.routes.js', () => ({ auditRoutes: async () => {} }))

import { createApp } from '../app.js'
import { AppError } from '@apphub/platform-sdk/errors'

let app
beforeEach(async () => {
  vi.clearAllMocks()
  app = createApp()
  app.get('/boom-zod', { config: { public: true } }, async () => { throw new z.ZodError([]) })
  app.get('/boom-app', { config: { public: true } }, async () => { throw new AppError('NOPE', 'no', 409) })
  app.get('/boom-app5', { config: { public: true } }, async () => { throw new AppError('FATAL', 'k', 500) })
  app.get('/boom-x', { config: { public: true } }, async () => { throw new Error('x') })
  app.get('/boom-fst', { config: { public: true } }, async () => {
    const e = new Error('fst'); e.code = 'FST_ERR_VALIDATION'; e.validation = [{ message: 'bad' }]; throw e
  })
  await app.ready()
})
afterEach(async () => { await app.close() })

it('health ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.json().service).toBe('platform-tenant-config')
})

it('notFound → 404', async () => {
  expect((await app.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(404)
})

it('ZodError → 422', async () => {
  expect((await app.inject({ method: 'GET', url: '/boom-zod' })).statusCode).toBe(422)
})

it('AppError 409', async () => {
  expect((await app.inject({ method: 'GET', url: '/boom-app' })).statusCode).toBe(409)
})

it('AppError 500', async () => {
  expect((await app.inject({ method: 'GET', url: '/boom-app5' })).statusCode).toBe(500)
})

it('error desconocido → 500', async () => {
  expect((await app.inject({ method: 'GET', url: '/boom-x' })).statusCode).toBe(500)
})

it('FST_ERR_VALIDATION (no Zod) → 422 con err.validation', async () => {
  const res = await app.inject({ method: 'GET', url: '/boom-fst' })
  expect(res.statusCode).toBe(422)
  expect(res.json().error.details).toEqual([{ message: 'bad' }])
})
