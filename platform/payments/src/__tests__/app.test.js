// createApp — composition root: health público, notFound handler y el
// errorHandler en sus tres ramas (ZodError/validation → 422, AppError →
// statusCode propio, error desconocido → 500).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@apphub/platform-sdk/app-guard', () => ({
  appGuard: async () => {},
  requireRole: () => async () => {},
}))

import { createApp } from '../app.js'
import { AppError } from '@apphub/platform-sdk/errors'

let app
beforeEach(async () => {
  app = createApp()
  // Rutas de prueba públicas que lanzan para ejercitar el errorHandler.
  app.get('/boom-zod', { config: { public: true } }, async () => { throw new z.ZodError([]) })
  app.get('/boom-app', { config: { public: true } }, async () => {
    throw new AppError('NOPE', 'Client said no', 409)
  })
  app.get('/boom-app-500', { config: { public: true } }, async () => {
    throw new AppError('FATAL', 'kaboom', 500)
  })
  app.get('/boom-unknown', { config: { public: true } }, async () => { throw new Error('plain') })
  app.get('/boom-fst', { config: { public: true } }, async () => {
    const e = new Error('fst validation')
    e.code = 'FST_ERR_VALIDATION'
    e.validation = [{ message: 'bad' }]
    throw e
  })
  await app.ready()
})
afterEach(async () => { await app.close() })

it('health responde ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json().status).toBe('ok')
})

it('notFound → 404 NOT_FOUND', async () => {
  const res = await app.inject({ method: 'GET', url: '/nope' })
  expect(res.statusCode).toBe(404)
  expect(res.json().error.code).toBe('NOT_FOUND')
})

it('ZodError → 422 VALIDATION_ERROR', async () => {
  const res = await app.inject({ method: 'GET', url: '/boom-zod' })
  expect(res.statusCode).toBe(422)
  expect(res.json().error.code).toBe('VALIDATION_ERROR')
})

it('FST_ERR_VALIDATION (no Zod) → 422 con err.validation', async () => {
  const res = await app.inject({ method: 'GET', url: '/boom-fst' })
  expect(res.statusCode).toBe(422)
  expect(res.json().error.code).toBe('VALIDATION_ERROR')
  expect(res.json().error.details).toEqual([{ message: 'bad' }])
})

it('AppError <500 → statusCode propio', async () => {
  const res = await app.inject({ method: 'GET', url: '/boom-app' })
  expect(res.statusCode).toBe(409)
  expect(res.json().error.code).toBe('NOPE')
})

it('AppError >=500 → statusCode propio (rama logger.error)', async () => {
  const res = await app.inject({ method: 'GET', url: '/boom-app-500' })
  expect(res.statusCode).toBe(500)
  expect(res.json().error.code).toBe('FATAL')
})

it('error desconocido → 500 INTERNAL_ERROR', async () => {
  const res = await app.inject({ method: 'GET', url: '/boom-unknown' })
  expect(res.statusCode).toBe(500)
  expect(res.json().error.code).toBe('INTERNAL_ERROR')
})
