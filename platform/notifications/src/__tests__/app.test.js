// createApp — composition root de notifications. Cubre health, notFound,
// las 3 ramas del errorHandler y el hook onReady → startEventConsumer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@apphub/platform-sdk/app-guard', () => ({
  appGuard: async () => {},
  requireRole: () => async () => {},
}))
const startEventConsumer = vi.hoisted(() => vi.fn())
vi.mock('../services/event-consumer.js', () => ({ startEventConsumer }))

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
  await app.ready()
})
afterEach(async () => { await app.close() })

it('onReady arranca el event consumer', () => {
  expect(startEventConsumer).toHaveBeenCalled()
})

it('health ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.json().service).toBe('platform-notifications')
})

it('notFound → 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/nope' })
  expect(res.statusCode).toBe(404)
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
