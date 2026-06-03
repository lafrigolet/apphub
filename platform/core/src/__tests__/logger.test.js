import { describe, it, expect } from 'vitest'

// Set required env BEFORE importing env.js (transitively imported by logger).
process.env.MIGRATION_DATABASE_URL  ??= 'postgresql://x:y@localhost:5432/test'
process.env.REDIS_URL               ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET     ??= 'test_secret_at_least_32_characters_long_ok'
process.env.DATABASE_URL_AUTH       ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_NOTIFICATIONS ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_PAYMENTS   ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_TENANT_CONFIG ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_SPLITPAY   ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_STORAGE    ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_LEADS      ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_DONATIONS  ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_INQUIRIES  ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_VERIFACTU  ??= 'postgresql://a:b@localhost:5432/test'
process.env.DATABASE_URL_CHAT       ??= 'postgresql://a:b@localhost:5432/test'
process.env.S3_ENDPOINT             ??= 'http://minio:9000'
process.env.S3_ACCESS_KEY           ??= 'k'
process.env.S3_SECRET_KEY           ??= 's'

import { logger } from '../lib/logger.js'

describe('logger', () => {
  it('exports a logger object', () => {
    expect(logger).toBeDefined()
    expect(typeof logger).toBe('object')
  })

  it('has the standard log level methods', () => {
    for (const level of ['info', 'warn', 'error', 'debug']) {
      expect(typeof logger[level]).toBe('function')
    }
  })

  it('supports child loggers (used per-module by server.js)', () => {
    const child = logger.child({ module: 'test' })
    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
  })
})
