// Cobertura del setErrorHandler de app.js: ramas AppError (4xx/5xx) y
// la rama `err.validation` (FST_ERR_VALIDATION que NO es ZodError), más
// el fallthrough de error no manejado (500). Se montan rutas efímeras
// que lanzan cada tipo de error antes de `app.ready()`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', PORT: 3003,
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    EXPECTED_APP_ID: 'platform', LOG_LEVEL: 'silent',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@apphub/platform-sdk/app-guard', () => ({
  appGuard: async () => {},
  requireRole: () => async () => {},
}))

import { AppError } from '@apphub/platform-sdk/errors'
import { createApp } from '../app.js'

let app
beforeEach(() => { app = createApp() })
afterEach(async () => { vi.clearAllMocks(); await app.close() })

describe('setErrorHandler', () => {
  it('AppError 4xx → status del error + warn (rama client error)', async () => {
    app.get('/boom-4xx', { config: { public: true } }, async () => {
      throw new AppError('CONFLICT', 'ya existe', 409)
    })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/boom-4xx' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: 'CONFLICT', message: 'ya existe' })
  })

  it('AppError 5xx → status del error + logger.error (rama server error)', async () => {
    app.get('/boom-5xx', { config: { public: true } }, async () => {
      throw new AppError('OAUTH_NOT_CONFIGURED', 'no config', 501)
    })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/boom-5xx' })
    expect(res.statusCode).toBe(501)
    expect(res.json().error.code).toBe('OAUTH_NOT_CONFIGURED')
  })

  it('error genérico (no AppError/Zod) → 500 INTERNAL_ERROR', async () => {
    app.get('/boom-unhandled', { config: { public: true } }, async () => {
      throw new Error('kaboom')
    })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/boom-unhandled' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
  })

  it('FST_ERR_VALIDATION (no ZodError) → 422 con err.validation', async () => {
    app.get('/boom-fst', { config: { public: true } }, async () => {
      const e = new Error('validation failed')
      e.code = 'FST_ERR_VALIDATION'
      e.validation = [{ message: 'bad', instancePath: '/x' }]
      throw e
    })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/boom-fst' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(res.json().error.details).toEqual([{ message: 'bad', instancePath: '/x' }])
  })
})
