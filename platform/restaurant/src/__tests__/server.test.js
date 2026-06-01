// platform-restaurant server — boot coherente de los 6 módulos del monolito.
// server.js NO exporta start(): lo invoca al importarse. Importamos una vez en
// beforeAll, esperamos a listen() y asertamos sobre el historial.
import { describe, it, expect, beforeAll, vi } from 'vitest'

const MODULES = ['menu', 'floor-plan', 'reservations', 'kds', 'pos', 'delivery-dispatch']

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

beforeAll(async () => {
  await import('../server.js')
  await vi.waitFor(() => { if (!fastifyApp.listen.mock.calls.length) throw new Error('listen not called yet') }, { timeout: 5000 })
})

describe('platform-restaurant — boot sequence', () => {
  it('runMigrations una vez por módulo con la MIGRATION_DATABASE_URL', () => {
    for (const m of MODULES) {
      expect(modulesMock[m].runMigrations).toHaveBeenCalledTimes(1)
      expect(modulesMock[m].runMigrations).toHaveBeenCalledWith(envMock.MIGRATION_DATABASE_URL)
    }
  })

  it('createPool una vez por módulo (los 6 tienen schema)', () => {
    expect(createPoolMock).toHaveBeenCalledTimes(MODULES.length)
  })

  it('createRedis singleton con REDIS_URL', () => {
    expect(createRedisMock).toHaveBeenCalledTimes(1)
    expect(createRedisMock).toHaveBeenCalledWith(envMock.REDIS_URL)
  })

  it('plugins cross-cutting + appGuard registrados', () => {
    const registered = fastifyApp.register.mock.calls.map((c) => c[0])
    for (const p of [plugins.helmet, plugins.cors, plugins.rateLimit, plugins.swagger, plugins.swaggerUi, appGuardMock]) {
      expect(registered).toContain(p)
    }
  })

  it('cada módulo.register({ app, db, redis, logger }) recibe sus deps', () => {
    for (const m of MODULES) {
      expect(modulesMock[m].register).toHaveBeenCalledTimes(1)
      const args = modulesMock[m].register.mock.calls[0][0]
      expect(args.app).toBe(fastifyApp)
      expect(args.db).not.toBeNull()
      expect(args.redis).toBeDefined()
      expect(args.logger).toBeDefined()
    }
  })

  it('/health público + listen en :3200 host 0.0.0.0', () => {
    const healthCall = fastifyApp.get.mock.calls.find((c) => c[0] === '/health')
    expect(healthCall?.[1]).toMatchObject({ config: { public: true } })
    expect(fastifyApp.listen).toHaveBeenCalledWith({ port: 3200, host: '0.0.0.0' })
  })

  it('compiler zod (validator + serializer) seteado', () => {
    expect(fastifyApp.setValidatorCompiler).toHaveBeenCalledWith(zodMocks.validatorCompiler)
    expect(fastifyApp.setSerializerCompiler).toHaveBeenCalledWith(zodMocks.serializerCompiler)
  })

  it('GET /health handler devuelve status ok + lista de módulos', async () => {
    const handler = fastifyApp.get.mock.calls.find((c) => c[0] === '/health')[2]
    const r = await handler()
    expect(r.status).toBe('ok')
    expect(r.service).toBe('platform-restaurant')
    expect(r.modules).toEqual(MODULES)
    expect(r.timestamp).toBeTypeOf('string')
  })

  it('hook onRequest invocable sin lanzar', async () => {
    const onRequestCall = fastifyApp.addHook.mock.calls.find((c) => c[0] === 'onRequest')
    expect(onRequestCall).toBeDefined()
    await expect(onRequestCall[1]({ method: 'GET', url: '/x' })).resolves.toBeUndefined()
  })

  it('pool.on("error") callbacks invocables', () => {
    const poolErrCbs = createPoolMock.mock.results
      .map((r) => r.value.on.mock.calls.find((c) => c[0] === 'error')?.[1])
      .filter(Boolean)
    expect(poolErrCbs.length).toBe(MODULES.length)
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

describe('platform-restaurant — notFound + error handler', () => {
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

describe('platform-restaurant — shutdown handler', () => {
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
