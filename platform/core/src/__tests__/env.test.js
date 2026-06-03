import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// env.js es un módulo con efecto lateral al cargarse (process.exit en
// caso de env inválido). Para testearlo necesitamos:
//  - manipular process.env antes del import
//  - usar vi.resetModules() entre tests para forzar re-evaluación
//  - capturar process.exit con un spy que THROW para no parar el runner.

const REQUIRED_VARS = {
  MIGRATION_DATABASE_URL:    'postgresql://x:y@localhost:5432/test',
  REDIS_URL:                 'redis://localhost:6379',
  PLATFORM_JWT_SECRET:       'test_secret_at_least_32_characters_long_ok',
  DATABASE_URL_AUTH:           'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_NOTIFICATIONS:  'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_PAYMENTS:       'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_TENANT_CONFIG:  'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_SPLITPAY:       'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_STORAGE:        'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_LEADS:          'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_DONATIONS:      'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_INQUIRIES:      'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_VERIFACTU:      'postgresql://a:b@localhost:5432/test',
  DATABASE_URL_CHAT:           'postgresql://a:b@localhost:5432/test',
  S3_ENDPOINT:                 'http://minio:9000',
  S3_ACCESS_KEY:               'k',
  S3_SECRET_KEY:               's',
}

const OPTIONAL_TO_CLEAR = [
  'NODE_ENV', 'PLATFORM_CORE_PORT', 'PLATFORM_JWT_REFRESH_DAYS',
  'EXPECTED_APP_ID', 'LOG_LEVEL', 'ALLOWED_ORIGINS', 'S3_REGION', 'S3_BUCKET',
  'S3_FORCE_PATH_STYLE', 'S3_PUBLIC_ENDPOINT',
  'GOOGLE_CLIENT_ID', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET',
  'RESEND_API_KEY', 'EMAIL_FROM_ADDRESS',
  'PLATFORM_STRIPE_SECRET_KEY', 'PLATFORM_STRIPE_WEBHOOK_SECRET',
  'SPLITPAY_STRIPE_SECRET_KEY', 'SPLITPAY_STRIPE_WEBHOOK_SECRET',
  'SPLITPAY_STRIPE_PUBLISHABLE_KEY', 'SPLITPAY_STRIPE_PLATFORM_ACCOUNT_ID',
]

let originalEnv
let consoleErrorSpy
let processExitSpy

beforeEach(() => {
  originalEnv = { ...process.env }
  for (const k of [...Object.keys(REQUIRED_VARS), ...OPTIONAL_TO_CLEAR]) delete process.env[k]
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  processExitSpy  = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`)
  })
  vi.resetModules()
})

afterEach(() => {
  process.env = originalEnv
  consoleErrorSpy.mockRestore()
  processExitSpy.mockRestore()
})

describe('env — happy path', () => {
  it('parses con todas las required + defaults', async () => {
    Object.assign(process.env, REQUIRED_VARS)
    const { env } = await import('../lib/env.js')
    expect(env.MIGRATION_DATABASE_URL).toBe(REQUIRED_VARS.MIGRATION_DATABASE_URL)
    expect(env.NODE_ENV).toBe('development')      // default
    expect(env.PLATFORM_CORE_PORT).toBe(3000)     // default coerce
    expect(env.PLATFORM_JWT_REFRESH_DAYS).toBe(30)
    expect(env.EXPECTED_APP_ID).toBe('platform')
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.S3_REGION).toBe('us-east-1')
    expect(env.S3_BUCKET).toBe('apphub')
    expect(env.S3_FORCE_PATH_STYLE).toBe(true)
  })

  it('coerce números a int (PORT, REFRESH_DAYS)', async () => {
    Object.assign(process.env, REQUIRED_VARS, {
      PLATFORM_CORE_PORT:        '3030',
      PLATFORM_JWT_REFRESH_DAYS: '7',
    })
    const { env } = await import('../lib/env.js')
    expect(env.PLATFORM_CORE_PORT).toBe(3030)
    expect(env.PLATFORM_JWT_REFRESH_DAYS).toBe(7)
  })

  it('NODE_ENV acepta "test" y "production"', async () => {
    Object.assign(process.env, REQUIRED_VARS, { NODE_ENV: 'test' })
    const m1 = await import('../lib/env.js?test1')
    expect(m1.env.NODE_ENV).toBe('test')

    vi.resetModules()
    Object.assign(process.env, REQUIRED_VARS, { NODE_ENV: 'production' })
    const m2 = await import('../lib/env.js?test2')
    expect(m2.env.NODE_ENV).toBe('production')
  })

  it('LOG_LEVEL acepta valores del enum', async () => {
    Object.assign(process.env, REQUIRED_VARS, { LOG_LEVEL: 'debug' })
    let m = await import('../lib/env.js?ll-debug')
    expect(m.env.LOG_LEVEL).toBe('debug')

    vi.resetModules()
    Object.assign(process.env, REQUIRED_VARS, { LOG_LEVEL: 'silent' })
    m = await import('../lib/env.js?ll-silent')
    expect(m.env.LOG_LEVEL).toBe('silent')
  })

  it('OAuth + Stripe + Resend quedan undefined si no se pasan (todos optional)', async () => {
    Object.assign(process.env, REQUIRED_VARS)
    const { env } = await import('../lib/env.js')
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
    expect(env.FACEBOOK_APP_ID).toBeUndefined()
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.PLATFORM_STRIPE_SECRET_KEY).toBeUndefined()
    expect(env.SPLITPAY_STRIPE_PUBLISHABLE_KEY).toBeUndefined()
  })

  it('valores opcionales se persisten cuando están presentes', async () => {
    Object.assign(process.env, REQUIRED_VARS, {
      ALLOWED_ORIGINS:           'https://a.com,https://b.com',
      GOOGLE_CLIENT_ID:          'gid',
      RESEND_API_KEY:            'rk',
      EMAIL_FROM_ADDRESS:        'noreply@x.com',
      PLATFORM_STRIPE_SECRET_KEY: 'sk_test',
    })
    const { env } = await import('../lib/env.js')
    expect(env.ALLOWED_ORIGINS).toBe('https://a.com,https://b.com')
    expect(env.GOOGLE_CLIENT_ID).toBe('gid')
    expect(env.RESEND_API_KEY).toBe('rk')
    expect(env.EMAIL_FROM_ADDRESS).toBe('noreply@x.com')
    expect(env.PLATFORM_STRIPE_SECRET_KEY).toBe('sk_test')
  })
})

describe('env — validación / process.exit', () => {
  // NB: este test importa el módulo por su ruta canónica (sin query-string)
  // para que v8 atribuya la cobertura de la rama de fallo (líneas 62-66) al
  // fichero src/lib/env.js — los imports `?query` cuentan como módulos
  // distintos y no cubrirían esa rama en el reporte canónico.
  it('process.exit(1) por la ruta canónica cuando falta una required (cubre la rama de fallo)', async () => {
    Object.assign(process.env, REQUIRED_VARS)
    delete process.env.REDIS_URL
    await expect(import('../lib/env.js')).rejects.toThrow('process.exit(1)')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('process.exit(1) cuando falta MIGRATION_DATABASE_URL', async () => {
    Object.assign(process.env, REQUIRED_VARS)
    delete process.env.MIGRATION_DATABASE_URL
    await expect(import('../lib/env.js?missing-mig')).rejects.toThrow('process.exit(1)')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('process.exit(1) cuando PLATFORM_JWT_SECRET es muy corto (<32)', async () => {
    Object.assign(process.env, REQUIRED_VARS, { PLATFORM_JWT_SECRET: 'tooshort' })
    await expect(import('../lib/env.js?short-secret')).rejects.toThrow('process.exit(1)')
    // env.js loguea el objeto de fieldErrors directamente. Inspeccionamos los
    // args de console.error para confirmar que zod identificó el campo.
    const objArg = consoleErrorSpy.mock.calls
      .map((c) => c.find((x) => typeof x === 'object' && x !== null))
      .find(Boolean)
    expect(objArg).toBeTruthy()
    expect(Object.keys(objArg)).toContain('PLATFORM_JWT_SECRET')
  })

  it('process.exit(1) cuando un DATABASE_URL_* no es URL válida', async () => {
    Object.assign(process.env, REQUIRED_VARS, { DATABASE_URL_AUTH: 'not a url' })
    await expect(import('../lib/env.js?bad-url')).rejects.toThrow('process.exit(1)')
  })

  it('process.exit(1) cuando S3_ENDPOINT no es URL', async () => {
    Object.assign(process.env, REQUIRED_VARS, { S3_ENDPOINT: 'invalid' })
    await expect(import('../lib/env.js?bad-s3')).rejects.toThrow('process.exit(1)')
  })

  it('process.exit(1) cuando NODE_ENV es un valor fuera del enum', async () => {
    Object.assign(process.env, REQUIRED_VARS, { NODE_ENV: 'staging' })
    await expect(import('../lib/env.js?bad-env')).rejects.toThrow('process.exit(1)')
  })

  it('process.exit(1) cuando EMAIL_FROM_ADDRESS no es email válido', async () => {
    Object.assign(process.env, REQUIRED_VARS, { EMAIL_FROM_ADDRESS: 'not-an-email' })
    await expect(import('../lib/env.js?bad-email')).rejects.toThrow('process.exit(1)')
  })
})
