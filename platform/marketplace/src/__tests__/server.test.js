// platform-marketplace server — boot coherente de los 8 módulos del monolito.
// server.js NO exporta start(): lo invoca al importarse (`node src/server.js`).
// Por eso importamos UNA vez en beforeAll, esperamos a que listen() ocurra y
// luego asertamos sobre el historial de llamadas (sin clearAllMocks, que
// borraría ese historial).
import { describe, it, expect, beforeAll, vi } from 'vitest'

const MODULES = ['inventory', 'orders', 'shipping', 'reviews', 'messaging', 'disputes', 'catalog', 'basket']
// basket es Redis-only (databaseUrl null) → no crea Pool.
const DB_MODULES = MODULES.filter((m) => m !== 'basket')

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
  const modulesMock = Object.fromEntries(['inventory', 'orders', 'shipping', 'reviews', 'messaging', 'disputes', 'catalog', 'basket'].map((m) => [m, mk()]))
  const loggerObj = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
  loggerObj.child = vi.fn(() => loggerObj)
  const loggerMock = { logger: loggerObj, AppError }
  const envMock = {
    NODE_ENV: 'test', PLATFORM_MARKETPLACE_PORT: 3100, REDIS_URL: 'redis://localhost:6379',
    MIGRATION_DATABASE_URL: 'postgresql://x:y@localhost:5432/test',
    ...Object.fromEntries(['ORDERS', 'INVENTORY', 'REVIEWS', 'MESSAGING', 'SHIPPING', 'DISPUTES', 'CATALOG'].map((m) => [`DATABASE_URL_${m}`, `postgresql://${m}:s@localhost:5432/test`])),
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
vi.mock('@apphub/platform-inventory', () => modulesMock.inventory)
vi.mock('@apphub/platform-orders', () => modulesMock.orders)
vi.mock('@apphub/platform-shipping', () => modulesMock.shipping)
vi.mock('@apphub/platform-reviews', () => modulesMock.reviews)
vi.mock('@apphub/platform-messaging', () => modulesMock.messaging)
vi.mock('@apphub/platform-disputes', () => modulesMock.disputes)
vi.mock('@apphub/platform-catalog', () => modulesMock.catalog)
vi.mock('@apphub/platform-basket', () => modulesMock.basket)

beforeAll(async () => {
  await import('../server.js')
  await vi.waitFor(() => { if (!fastifyApp.listen.mock.calls.length) throw new Error('listen not called yet') }, { timeout: 5000 })
})

describe('platform-marketplace — boot sequence', () => {
  it('runMigrations se llama una vez por cada módulo con la MIGRATION_DATABASE_URL', () => {
    for (const m of MODULES) {
      expect(modulesMock[m].runMigrations).toHaveBeenCalledTimes(1)
      expect(modulesMock[m].runMigrations).toHaveBeenCalledWith(envMock.MIGRATION_DATABASE_URL)
    }
  })

  it('createPool se llama una vez por módulo con DB (basket es Redis-only → sin Pool)', () => {
    expect(createPoolMock).toHaveBeenCalledTimes(DB_MODULES.length)
  })

  it('createRedis singleton — una sola vez con REDIS_URL', () => {
    expect(createRedisMock).toHaveBeenCalledTimes(1)
    expect(createRedisMock).toHaveBeenCalledWith(envMock.REDIS_URL)
  })

  it('plugins cross-cutting registrados (helmet, cors, rate-limit, swagger, swagger-ui, appGuard)', () => {
    const registered = fastifyApp.register.mock.calls.map((c) => c[0])
    expect(registered).toContain(plugins.helmet)
    expect(registered).toContain(plugins.cors)
    expect(registered).toContain(plugins.rateLimit)
    expect(registered).toContain(plugins.swagger)
    expect(registered).toContain(plugins.swaggerUi)
    expect(registered).toContain(appGuardMock)
  })

  it('cada módulo.register({ app, redis, logger }) recibe sus deps', () => {
    for (const m of MODULES) {
      expect(modulesMock[m].register).toHaveBeenCalledTimes(1)
      const args = modulesMock[m].register.mock.calls[0][0]
      expect(args.app).toBe(fastifyApp)
      expect(args.redis).toBeDefined()
      expect(args.logger).toBeDefined()
      expect('db' in args).toBe(true)
    }
  })

  it('basket.register recibe db=null (Redis-only); orders recibe un Pool', () => {
    expect(modulesMock.basket.register.mock.calls[0][0].db).toBeNull()
    expect(modulesMock.orders.register.mock.calls[0][0].db).not.toBeNull()
  })

  it('compiler zod seteado + /health público registrado', () => {
    expect(fastifyApp.setValidatorCompiler).toHaveBeenCalledWith(zodMocks.validatorCompiler)
    const healthCall = fastifyApp.get.mock.calls.find((c) => c[0] === '/health')
    expect(healthCall).toBeDefined()
    expect(healthCall[1]).toMatchObject({ config: { public: true } })
  })

  it('listen() con el puerto del monolito y host 0.0.0.0', () => {
    expect(fastifyApp.listen).toHaveBeenCalledWith({ port: 3100, host: '0.0.0.0' })
  })

  it('GET /health handler devuelve status ok + lista de módulos', async () => {
    const handler = fastifyApp.get.mock.calls.find((c) => c[0] === '/health')[2]
    const r = await handler()
    expect(r.status).toBe('ok')
    expect(r.service).toBe('platform-marketplace')
    expect(r.modules).toEqual(MODULES)
    expect(r.timestamp).toBeTypeOf('string')
  })

  it('hook onRequest invocable sin lanzar', async () => {
    const onRequestCall = fastifyApp.addHook.mock.calls.find((c) => c[0] === 'onRequest')
    expect(onRequestCall).toBeDefined()
    await expect(onRequestCall[1]({ method: 'GET', url: '/x' })).resolves.toBeUndefined()
  })

  it('pool.on("error") callbacks invocables (uno por módulo con DB)', () => {
    const poolErrCbs = createPoolMock.mock.results
      .map((r) => r.value.on.mock.calls.find((c) => c[0] === 'error')?.[1])
      .filter(Boolean)
    expect(poolErrCbs.length).toBe(DB_MODULES.length)
    for (const cb of poolErrCbs) expect(() => cb(new Error('pool down'))).not.toThrow()
  })

  it('redis.on("connect") y redis.on("error") invocables', () => {
    const fakeRedis = createRedisMock.mock.results.at(-1).value
    const connectCb = fakeRedis.on.mock.calls.find((c) => c[0] === 'connect')[1]
    const errorCb   = fakeRedis.on.mock.calls.find((c) => c[0] === 'error')[1]
    expect(() => connectCb()).not.toThrow()
    expect(() => errorCb(new Error('redis down'))).not.toThrow()
  })

  it('rate-limit errorResponseBuilder devuelve el shape esperado', () => {
    const opts = fastifyApp.register.mock.calls.find((c) => c[0] === plugins.rateLimit)[1]
    expect(opts.max).toBe(60)
    expect(opts.errorResponseBuilder()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } })
  })
})

describe('platform-marketplace — notFound + error handler', () => {
  it('setNotFoundHandler responde 404 NOT_FOUND', () => {
    const handler = fastifyApp.setNotFoundHandler.mock.calls[0][0]
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler({}, reply)
    expect(reply.status).toHaveBeenCalledWith(404)
    expect(reply.send).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  it('ZodError → 422 VALIDATION_ERROR', async () => {
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const { ZodError } = await import('zod')
    const err = new ZodError([])
    err.flatten = () => ({ fieldErrors: { foo: ['Required'] } })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(422)
    expect(reply.send.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR')
  })

  it('FST_ERR_VALIDATION → 422 con validation como details', () => {
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const err = Object.assign(new Error('bad'), { code: 'FST_ERR_VALIDATION', validation: [{ keyword: 'required' }] })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(422)
    expect(reply.send.mock.calls[0][0].error.details).toEqual([{ keyword: 'required' }])
  })

  it('AppError 4xx → status propio (warn path)', () => {
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const err = Object.assign(new loggerMock.AppError('duplicate'), { code: 'CONFLICT', statusCode: 409, details: { foo: 'bar' } })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(409)
    expect(reply.send).toHaveBeenCalledWith({ error: { code: 'CONFLICT', message: 'duplicate', details: { foo: 'bar' } } })
  })

  it('AppError 5xx → status propio (error path)', () => {
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const err = Object.assign(new loggerMock.AppError('db down'), { code: 'DB_DOWN', statusCode: 503 })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(503)
    expect(reply.send.mock.calls[0][0].error.code).toBe('DB_DOWN')
  })

  it('error desconocido → 500 INTERNAL_ERROR', () => {
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(new Error('boom'), {}, reply)
    expect(reply.status).toHaveBeenCalledWith(500)
    expect(reply.send.mock.calls[0][0].error.code).toBe('INTERNAL_ERROR')
  })
})

describe('platform-marketplace — shutdown handler', () => {
  let exitSpy
  beforeAll(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit(${code})`) })
  })

  it('SIGTERM cierra app, vacía pools y llama redis.quit + exit(0)', async () => {
    const handler = sigListener('SIGTERM')
    expect(handler).toBeDefined()
    const fakeRedis = createRedisMock.mock.results.at(-1).value
    fastifyApp.close.mockResolvedValueOnce(undefined)
    try { await handler() } catch { /* exit mock throws */ }
    expect(fastifyApp.close).toHaveBeenCalled()
    expect(fakeRedis.quit).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('SIGINT registrado y dispara shutdown', async () => {
    const handler = sigListener('SIGINT')
    expect(handler).toBeDefined()
    try { await handler() } catch { /* exit mock throws */ }
    expect(fastifyApp.close).toHaveBeenCalled()
  })

  it('si app.close lanza → exit(1)', async () => {
    const handler = sigListener('SIGTERM')
    fastifyApp.close.mockRejectedValueOnce(new Error('close failed'))
    try { await handler() } catch { /* exit mock throws */ }
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1)
  })
})

function sigListener(signal) {
  const ls = process.listeners(signal)
  return ls[ls.length - 1]
}
