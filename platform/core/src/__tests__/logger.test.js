import { describe, it, expect, beforeAll } from 'vitest'

// Set required env BEFORE importing env.js (transitively imported by logger).
process.env.MIGRATION_DATABASE_URL  ??= 'postgresql://x:y@localhost:5432/test'
process.env.REDIS_URL               ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET     ??= 'test_secret_at_least_32_characters_long_ok'
for (const m of [
  'AUTH','NOTIFICATIONS','PAYMENTS','TENANT_CONFIG','SPLITPAY','STORAGE','LEADS','DONATIONS','INQUIRIES','VERIFACTU','CHAT','TPV','COMMERCE',
  'ORDERS','INVENTORY','REVIEWS','MESSAGING','SHIPPING','DISPUTES','CATALOG',
  'MENU','RESERVATIONS','FLOOR_PLAN','KDS','POS','DELIVERY_DISPATCH',
  'SERVICES','RESOURCES','BOOKINGS','AVAILABILITY','INTAKE_FORMS','TELEHEALTH','PACKAGES','PRACTITIONER_PAYOUTS',
]) {
  process.env[`DATABASE_URL_${m}`]  ??= 'postgresql://a:b@localhost:5432/test'
}
process.env.S3_ENDPOINT             ??= 'http://minio:9000'
process.env.S3_ACCESS_KEY           ??= 'k'
process.env.S3_SECRET_KEY           ??= 's'

// Import dinámico: el `import` estático se hoista por encima del setup de env
// de arriba (ESM), así que cargamos logger DESPUÉS de fijar las env vars.
let logger
beforeAll(async () => { ({ logger } = await import('../lib/logger.js')) })

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
