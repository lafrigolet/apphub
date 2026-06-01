// platform-restaurant — rutas de fallo del boot.
// Re-importamos con vi.resetModules() bajo mocks que fuerzan fallo:
// contrato de módulo (loadModule throw) → start().catch; y app.listen
// rechazando → catch interno → process.exit(1).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { fastifyApp, fastifyFactory, plugins, zodMocks, appGuardMock, createPoolMock, createRedisMock, modulesMock, envMock, loggerMock } = vi.hoisted(() => {
  const fastifyApp = {
    register: vi.fn().mockResolvedValue(undefined),
    addHook: vi.fn(), get: vi.fn(),
    setNotFoundHandler: vi.fn(), setErrorHandler: vi.fn(),
    setValidatorCompiler: vi.fn(), setSerializerCompiler: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const plugins = { helmet: vi.fn(), cors: vi.fn(), rateLimit: vi.fn(), swagger: vi.fn(), swaggerUi: vi.fn() }
  const zodMocks = { serializerCompiler: vi.fn(), validatorCompiler: vi.fn(), jsonSchemaTransform: vi.fn() }
  const appGuardMock = vi.fn()
  class AppError extends Error {}
  const createPoolMock = vi.fn(() => ({ on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }))
  const fakeRedis = { on: vi.fn(), quit: vi.fn().mockResolvedValue(undefined) }
  const createRedisMock = vi.fn(() => fakeRedis)
  const mk = () => ({ register: vi.fn().mockResolvedValue(undefined), runMigrations: vi.fn().mockResolvedValue(undefined) })
  const modulesMock = Object.fromEntries(['menu', 'floor-plan', 'reservations', 'kds', 'pos', 'delivery-dispatch'].map((m) => [m, mk()]))
  const loggerObj = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
  loggerObj.child = vi.fn(() => loggerObj)
  const loggerMock = { logger: loggerObj, AppError }
  const envMock = {
    NODE_ENV: 'test', PLATFORM_RESTAURANT_PORT: 3200, REDIS_URL: 'redis://localhost:6379',
    MIGRATION_DATABASE_URL: 'postgresql://x:y@localhost:5432/test',
    ...Object.fromEntries(['MENU', 'RESERVATIONS', 'FLOOR_PLAN', 'KDS', 'POS', 'DELIVERY_DISPATCH'].map((m) => [`DATABASE_URL_${m}`, `postgresql://${m}:s@localhost:5432/test`])),
  }
  return { fastifyApp, fastifyFactory: vi.fn(() => fastifyApp), plugins, zodMocks, appGuardMock, createPoolMock, createRedisMock, modulesMock, envMock, loggerMock }
})

vi.mock('fastify', () => ({ default: fastifyFactory }))
vi.mock('@fastify/helmet', () => ({ default: plugins.helmet }))
vi.mock('@fastify/cors', () => ({ default: plugins.cors }))
vi.mock('@fastify/rate-limit', () => ({ default: plugins.rateLimit }))
vi.mock('@fastify/swagger', () => ({ default: plugins.swagger }))
vi.mock('@fastify/swagger-ui', () => ({ default: plugins.swaggerUi }))
vi.mock('fastify-type-provider-zod', () => zodMocks)
vi.mock('@apphub/platform-sdk/app-guard', () => ({ appGuard: appGuardMock }))
vi.mock('@apphub/platform-sdk/errors', () => ({ AppError: loggerMock.AppError }))
vi.mock('@apphub/platform-sdk/db', () => ({ createPool: createPoolMock }))
vi.mock('@apphub/platform-sdk/redis', () => ({ createRedis: createRedisMock }))
vi.mock('./lib/env.js', () => ({ env: envMock }))
vi.mock('../lib/env.js', () => ({ env: envMock }))
vi.mock('./lib/logger.js', () => ({ logger: loggerMock.logger }))
vi.mock('../lib/logger.js', () => ({ logger: loggerMock.logger }))
vi.mock('@apphub/platform-menu', () => modulesMock.menu)
vi.mock('@apphub/platform-floor-plan', () => modulesMock['floor-plan'])
vi.mock('@apphub/platform-reservations', () => modulesMock.reservations)
vi.mock('@apphub/platform-kds', () => modulesMock.kds)
vi.mock('@apphub/platform-pos', () => modulesMock.pos)
vi.mock('@apphub/platform-delivery-dispatch', () => modulesMock['delivery-dispatch'])

let exitSpy, errorSpy

beforeEach(() => {
  vi.clearAllMocks()
  fastifyFactory.mockReturnValue(fastifyApp)
  fastifyApp.register.mockResolvedValue(undefined)
  fastifyApp.listen.mockResolvedValue(undefined)
  fastifyApp.close.mockResolvedValue(undefined)
  createPoolMock.mockImplementation(() => ({ on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }))
  createRedisMock.mockImplementation(() => ({ on: vi.fn(), quit: vi.fn().mockResolvedValue(undefined) }))
  for (const m of Object.values(modulesMock)) {
    m.register.mockResolvedValue(undefined)
    m.runMigrations.mockResolvedValue(undefined)
  }
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  exitSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('platform-restaurant — boot failure paths', () => {
  it('módulo sin register() válido → loadModule throws → start().catch → console.error + exit(1)', async () => {
    const real = modulesMock.menu.register
    modulesMock.menu.register = undefined
    vi.resetModules()
    await import('../server.js')
    await vi.waitFor(() => { if (!exitSpy.mock.calls.length) throw new Error('exit not called') }, { timeout: 5000 })
    expect(errorSpy).toHaveBeenCalledWith('Failed to start platform-restaurant:', expect.any(Error))
    expect(exitSpy).toHaveBeenCalledWith(1)
    modulesMock.menu.register = real
  })

  it('app.listen rechaza → catch interno → process.exit(1)', async () => {
    fastifyApp.listen.mockRejectedValue(new Error('EADDRINUSE'))
    vi.resetModules()
    await import('../server.js')
    await vi.waitFor(() => { if (!exitSpy.mock.calls.length) throw new Error('exit not called') }, { timeout: 5000 })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
