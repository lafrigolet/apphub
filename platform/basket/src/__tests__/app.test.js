// app.test — cubre el errorHandler de createApp() (app.js líneas 33-43):
// ZodError/FST_ERR_VALIDATION → 422, AppError <500 (warn) y >=500 (error),
// y error genérico → 500. Mockea el basket service para forzar cada rama
// desde una ruta real registrada por createApp().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { AppError } from '@apphub/platform-sdk/errors'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', PORT: 3004, REDIS_URL: 'redis://localhost:6379', EXPECTED_APP_ID: 'aikikan', LOG_LEVEL: 'silent' },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        if (req.routeOptions?.config?.public) return
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', role: 'user' }
      })
    }),
    requireRole: () => async () => {},
  }
})

vi.mock('../services/basket.service.js', () => ({
  getBasket: vi.fn(),
  upsertItem: vi.fn(), removeItem: vi.fn(), clearBasket: vi.fn(), mergeBaskets: vi.fn(),
  listSaved: vi.fn(), saveForLater: vi.fn(), moveBackToBasket: vi.fn(), removeSaved: vi.fn(),
}))
vi.mock('../services/promotions.service.js', () => ({
  basketSummary: vi.fn(), applyPromo: vi.fn(), clearPromo: vi.fn(),
  listPromos: vi.fn(), upsertPromo: vi.fn(), deletePromo: vi.fn(),
}))

import { createApp } from '../app.js'
import { logger } from '../lib/logger.js'
import { getBasket } from '../services/basket.service.js'

let app
beforeEach(async () => { vi.clearAllMocks(); app = createApp(); await app.ready() })
afterEach(async () => { await app.close() })

describe('createApp errorHandler', () => {
  it('AppError con statusCode <500 → status del error + logger.warn', async () => {
    getBasket.mockRejectedValue(new AppError('CONFLICT', 'nope', 409))
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: { Authorization: 'Bearer x' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLICT')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('AppError con statusCode >=500 → logger.error', async () => {
    getBasket.mockRejectedValue(new AppError('UPSTREAM', 'boom', 503))
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: { Authorization: 'Bearer x' } })
    expect(res.statusCode).toBe(503)
    expect(logger.error).toHaveBeenCalled()
  })

  it('error genérico → 500 INTERNAL_ERROR', async () => {
    getBasket.mockRejectedValue(new Error('unexpected'))
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: { Authorization: 'Bearer x' } })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
  })

  it('ValidationError (FST_ERR_VALIDATION) → 422', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      payload: { itemId: '', quantity: 0, name: '', priceCents: -1 },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('ZodError lanzado en el handler → 422 con flatten().fieldErrors', async () => {
    // Un ZodError genuino lanzado dentro del handler ejercita la rama
    // `err instanceof ZodError` (true) del errorHandler (línea 34).
    const zerr = z.object({ x: z.string() }).safeParse({ x: 1 }).error
    getBasket.mockRejectedValue(zerr)
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: { Authorization: 'Bearer x' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
    expect(res.json().error.details).toBeDefined()
  })
})
