// Cubre la rama de error del subscribe (línea: if (err) → logger.error + reject).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// El subscribe invoca el callback con un error → ejercita la rama if (err).
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn((_c, cb) => cb(new Error('subscribe failed'))),
    on: vi.fn(),
  })),
}))

import { startEventConsumer } from '../services/event-consumer.js'
import { logger } from '../lib/logger.js'

beforeEach(() => vi.clearAllMocks())

describe('subscribe error', () => {
  it('logger.error y la promesa ready rechaza', async () => {
    const sub = startEventConsumer()
    await expect(sub.ready).rejects.toThrow('subscribe failed')
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Failed to subscribe'),
    )
  })
})
