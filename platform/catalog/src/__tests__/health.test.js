import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3003,
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    EXPECTED_APP_ID: 'platform',
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@apphub/platform-sdk/app-guard', () => ({
  appGuard: async () => {},
  requireRole: () => async () => {},
}))

import { createApp } from '../app.js'

let app
beforeEach(async () => { app = createApp(); await app.ready() })
afterEach(async () => { vi.clearAllMocks(); await app.close() })

describe('platform-catalog', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', service: 'platform-catalog' })
  })

  it('GET /unknown returns 404 with NOT_FOUND code', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})
