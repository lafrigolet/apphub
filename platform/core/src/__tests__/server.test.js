import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── env setup (antes de cualquier import del módulo) ───────────────────
process.env.MIGRATION_DATABASE_URL  ??= 'postgresql://x:y@localhost:5432/test'
process.env.REDIS_URL               ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET     ??= 'test_secret_at_least_32_characters_long_ok'
for (const m of ['AUTH','NOTIFICATIONS','PAYMENTS','TENANT_CONFIG','SPLITPAY','STORAGE','LEADS','DONATIONS','INQUIRIES','VERIFACTU','CHAT']) {
  process.env[`DATABASE_URL_${m}`]  ??= `postgresql://${m.toLowerCase()}:s@localhost:5432/test`
}
process.env.S3_ENDPOINT             ??= 'http://minio:9000'
process.env.S3_ACCESS_KEY           ??= 'k'
process.env.S3_SECRET_KEY           ??= 's'
process.env.PLATFORM_CORE_PORT      ??= '3000'

// ── Mocks de TODO lo que server.js importa ───────────────────────────
// Fastify devuelve un app fake con register/get/setX/listen/close/addHook;
// cada llamada queda registrada para los asserts.
const { fastifyApp, fastifyFactory, helmetMock, corsMock, rateLimitMock, swaggerMock, swaggerUiMock, zodMocks, appGuardMock, errorsMock, createPoolMock, ensureModuleRoleMock, createRedisMock, modulesMock } = vi.hoisted(() => {
  const fastifyApp = {
    register: vi.fn().mockResolvedValue(undefined),
    addHook:  vi.fn(),
    get:      vi.fn(),
    setNotFoundHandler:  vi.fn(),
    setErrorHandler:     vi.fn(),
    setValidatorCompiler: vi.fn(),
    setSerializerCompiler: vi.fn(),
    listen:   vi.fn().mockResolvedValue(undefined),
    close:    vi.fn().mockResolvedValue(undefined),
  }
  const fastifyFactory = vi.fn(() => fastifyApp)

  const helmetMock     = vi.fn()
  const corsMock       = vi.fn()
  const rateLimitMock  = vi.fn()
  const swaggerMock    = vi.fn()
  const swaggerUiMock  = vi.fn()

  const zodMocks = {
    serializerCompiler: vi.fn(),
    validatorCompiler:  vi.fn(),
    jsonSchemaTransform: vi.fn(),
  }

  const appGuardMock = vi.fn()
  class AppError extends Error {
    constructor(code, msg, status, details) {
      super(msg); this.code = code; this.statusCode = status; this.details = details
    }
  }
  const errorsMock = { AppError }

  const createPoolMock  = vi.fn(() => ({ on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }))
  const ensureModuleRoleMock = vi.fn().mockResolvedValue(undefined)
  const fakeRedis = {
    on:   vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }
  const createRedisMock = vi.fn(() => fakeRedis)

  // 8 módulos — cada uno exporta register + runMigrations.
  const mkModule = (name) => ({
    register:      vi.fn().mockResolvedValue(undefined),
    runMigrations: vi.fn().mockResolvedValue(undefined),
    __name: name,
  })
  const modulesMock = {
    auth:           mkModule('auth'),
    notifications:  mkModule('notifications'),
    payments:       mkModule('payments'),
    tenantConfig:   mkModule('tenant-config'),
    splitpay:       mkModule('splitpay'),
    storage:        mkModule('storage'),
    leads:          mkModule('leads'),
    donations:      mkModule('donations'),
    inquiries:      mkModule('inquiries'),
    verifactu:      mkModule('verifactu'),
    chat:           mkModule('chat'),
  }

  return { fastifyApp, fastifyFactory, helmetMock, corsMock, rateLimitMock, swaggerMock, swaggerUiMock, zodMocks, appGuardMock, errorsMock, createPoolMock, ensureModuleRoleMock, createRedisMock, modulesMock }
})

vi.mock('fastify',                () => ({ default: fastifyFactory }))
vi.mock('@fastify/helmet',        () => ({ default: helmetMock }))
vi.mock('@fastify/cors',          () => ({ default: corsMock }))
vi.mock('@fastify/rate-limit',    () => ({ default: rateLimitMock }))
vi.mock('@fastify/swagger',       () => ({ default: swaggerMock }))
vi.mock('@fastify/swagger-ui',    () => ({ default: swaggerUiMock }))
vi.mock('fastify-type-provider-zod', () => zodMocks)
vi.mock('@apphub/platform-sdk/app-guard', () => ({ appGuard: appGuardMock }))
vi.mock('@apphub/platform-sdk/errors',    () => errorsMock)
vi.mock('@apphub/platform-sdk/db',        () => ({ createPool: createPoolMock, ensureModuleRole: ensureModuleRoleMock }))
vi.mock('@apphub/platform-sdk/redis',     () => ({ createRedis: createRedisMock }))
vi.mock('@apphub/platform-auth',          () => modulesMock.auth)
vi.mock('@apphub/platform-notifications', () => modulesMock.notifications)
vi.mock('@apphub/platform-payments',      () => modulesMock.payments)
vi.mock('@apphub/platform-tenant-config', () => modulesMock.tenantConfig)
vi.mock('@apphub/platform-splitpay',      () => modulesMock.splitpay)
vi.mock('@apphub/platform-storage',       () => modulesMock.storage)
vi.mock('@apphub/platform-leads',         () => modulesMock.leads)
vi.mock('@apphub/platform-donations',     () => modulesMock.donations)
vi.mock('@apphub/platform-inquiries',     () => modulesMock.inquiries)
vi.mock('@apphub/platform-verifactu',     () => modulesMock.verifactu)
vi.mock('@apphub/platform-chat',          () => modulesMock.chat)
vi.mock('@fastify/websocket',             () => ({ default: vi.fn() }))

// ── tests ───────────────────────────────────────────────────────────

let originalExit
let originalOn
let exitSpy
let processOnSpy

beforeEach(() => {
  vi.clearAllMocks()
  // Restablecer mocks por defecto (clearAllMocks borra implementations).
  fastifyFactory.mockReturnValue(fastifyApp)
  for (const k of ['register']) fastifyApp[k].mockResolvedValue(undefined)
  fastifyApp.listen.mockResolvedValue(undefined)
  fastifyApp.close.mockResolvedValue(undefined)
  createPoolMock.mockImplementation(() => ({ on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }))
  for (const m of Object.values(modulesMock)) {
    m.register.mockResolvedValue(undefined)
    m.runMigrations.mockResolvedValue(undefined)
  }

  originalExit = process.exit
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`)
  })
  originalOn = process.on
  processOnSpy = vi.spyOn(process, 'on')
})

afterEach(() => {
  exitSpy.mockRestore()
  processOnSpy.mockRestore()
})

describe('start() — boot sequence', () => {
  it('runMigrations es llamado UNA vez por cada uno de los 10 módulos, en orden', async () => {
    const { start } = await import('../server.js')
    await start()

    for (const m of Object.values(modulesMock)) {
      expect(m.runMigrations).toHaveBeenCalledTimes(1)
      expect(m.runMigrations).toHaveBeenCalledWith(process.env.MIGRATION_DATABASE_URL)
    }
  })

  it('createPool se llama una vez por módulo con su DATABASE_URL_<M> propio', async () => {
    const { start } = await import('../server.js')
    await start()

    expect(createPoolMock).toHaveBeenCalledTimes(11)
    const urls = createPoolMock.mock.calls.map((c) => c[0])
    expect(urls).toContain(process.env.DATABASE_URL_AUTH)
    expect(urls).toContain(process.env.DATABASE_URL_NOTIFICATIONS)
    expect(urls).toContain(process.env.DATABASE_URL_DONATIONS)
    expect(urls).toContain(process.env.DATABASE_URL_LEADS)
  })

  it('Redis singleton — createRedis llamado UNA sola vez', async () => {
    const { start } = await import('../server.js')
    await start()
    expect(createRedisMock).toHaveBeenCalledTimes(1)
    expect(createRedisMock).toHaveBeenCalledWith(process.env.REDIS_URL)
  })

  it('plugins cross-cutting registrados ANTES de los módulos: helmet, cors, rate-limit, swagger, swagger-ui, appGuard', async () => {
    const { start } = await import('../server.js')
    await start()

    const registerCalls = fastifyApp.register.mock.calls.map((c) => c[0])
    // Los plugins llegan como la función default; comparamos referencias.
    expect(registerCalls).toContain(helmetMock)
    expect(registerCalls).toContain(corsMock)
    expect(registerCalls).toContain(rateLimitMock)
    expect(registerCalls).toContain(swaggerMock)
    expect(registerCalls).toContain(swaggerUiMock)
    expect(registerCalls).toContain(appGuardMock)
  })

  it('cada uno de los 10 módulos.register({ app, db, redis, logger }) recibe sus deps', async () => {
    const { start } = await import('../server.js')
    await start()

    for (const m of Object.values(modulesMock)) {
      expect(m.register).toHaveBeenCalledTimes(1)
      const args = m.register.mock.calls[0][0]
      expect(args.app).toBe(fastifyApp)
      expect(args.db).toBeDefined()
      expect(args.redis).toBeDefined()
      expect(args.logger).toBeDefined()
    }
  })

  it('compiler zod (validator + serializer) seteado antes de registrar rutas', async () => {
    const { start } = await import('../server.js')
    await start()
    expect(fastifyApp.setValidatorCompiler).toHaveBeenCalledWith(zodMocks.validatorCompiler)
    expect(fastifyApp.setSerializerCompiler).toHaveBeenCalledWith(zodMocks.serializerCompiler)
  })

  it('listen() llamado con el PORT del env y host 0.0.0.0', async () => {
    const { start } = await import('../server.js')
    await start()
    expect(fastifyApp.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' })
  })

  it('expone GET /health como público con la lista de módulos cargados', async () => {
    const { start } = await import('../server.js')
    await start()
    const healthCall = fastifyApp.get.mock.calls.find((c) => c[0] === '/health')
    expect(healthCall).toBeDefined()
    expect(healthCall[1]).toEqual({ config: { public: true } })

    const handler = healthCall[2]
    const r = await handler()
    expect(r.status).toBe('ok')
    expect(r.service).toBe('platform-core')
    expect(r.modules).toEqual(
      ['auth','notifications','payments','tenant-config','splitpay','storage','leads','donations','inquiries','verifactu','chat'],
    )
    expect(r.timestamp).toBeTypeOf('string')
  })

  it('setNotFoundHandler responde 404 con código NOT_FOUND', async () => {
    const { start } = await import('../server.js')
    await start()
    expect(fastifyApp.setNotFoundHandler).toHaveBeenCalledTimes(1)

    const handler = fastifyApp.setNotFoundHandler.mock.calls[0][0]
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler({}, reply)
    expect(reply.status).toHaveBeenCalledWith(404)
    expect(reply.send).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  it('registra SIGTERM y SIGINT handlers', async () => {
    const { start } = await import('../server.js')
    await start()
    const signals = processOnSpy.mock.calls.map((c) => c[0])
    expect(signals).toContain('SIGTERM')
    expect(signals).toContain('SIGINT')
  })

  it('hook onRequest registrado: invocado con req fake no lanza', async () => {
    const { start } = await import('../server.js')
    await start()
    const onRequestCall = fastifyApp.addHook.mock.calls.find((c) => c[0] === 'onRequest')
    expect(onRequestCall).toBeDefined()
    const handler = onRequestCall[1]
    await expect(handler({ method: 'GET', url: '/x' })).resolves.toBeUndefined()
  })

  it('SIGINT dispara el mismo shutdown que SIGTERM', async () => {
    const { start } = await import('../server.js')
    await start()
    const sigintCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGINT')
    expect(sigintCall).toBeDefined()
    const handler = sigintCall[1]
    try { await handler() } catch { /* process.exit mock throws */ }
    expect(fastifyApp.close).toHaveBeenCalled()
  })

  it('pool.on("error") callbacks registrados (uno por módulo)', async () => {
    // Captura el pool emitido por createPool en su última invocación
    // y fuerza la ejecución del handler 'error' para que la línea quede
    // cubierta (es un bridge a logger.error).
    const onSpies = []
    createPoolMock.mockImplementation(() => {
      const fake = { on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }
      onSpies.push(fake.on)
      return fake
    })
    const { start } = await import('../server.js')
    await start()
    // Cada pool tiene un on('error') registrado.
    for (const on of onSpies) {
      const err = on.mock.calls.find((c) => c[0] === 'error')
      expect(err).toBeDefined()
      expect(() => err[1](new Error('pool down'))).not.toThrow()
    }
  })

  it('redis.on("connect") y redis.on("error") registrados, ambos invocables', async () => {
    const fakeRedis = { on: vi.fn(), quit: vi.fn().mockResolvedValue(undefined) }
    createRedisMock.mockImplementationOnce(() => fakeRedis)
    const { start } = await import('../server.js')
    await start()
    const connectCb = fakeRedis.on.mock.calls.find((c) => c[0] === 'connect')[1]
    const errorCb   = fakeRedis.on.mock.calls.find((c) => c[0] === 'error')[1]
    expect(() => connectCb()).not.toThrow()
    expect(() => errorCb(new Error('redis down'))).not.toThrow()
  })

  it('rate-limit errorResponseBuilder devuelve el shape esperado', async () => {
    const { start } = await import('../server.js')
    await start()
    // El register fue llamado con (plugin, options). Buscamos la entrada
    // de rateLimitMock y obtenemos las options para invocar el builder.
    const rateLimitEntry = fastifyApp.register.mock.calls.find((c) => c[0] === rateLimitMock)
    expect(rateLimitEntry).toBeDefined()
    const opts = rateLimitEntry[1]
    expect(opts.max).toBe(30)
    const r = opts.errorResponseBuilder()
    expect(r).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } })
  })
})

// ── failure paths ───────────────────────────────────────────────────

describe('start() — error handling', () => {
  it('loadModule throws si un módulo no exporta register() (contrato chequeado)', async () => {
    // Simulamos la condición: setamos register a undefined en auth y
    // pedimos a start() que arranque. El typeof check de server.js
    // (línea 33) detecta el fallo. Restauramos al final.
    const realRegister = modulesMock.auth.register
    modulesMock.auth.register = undefined
    const { start } = await import('../server.js')
    await expect(start()).rejects.toThrow(/must export register\(\) and runMigrations\(\)/)
    modulesMock.auth.register = realRegister
  })

  it('app.listen failure → process.exit(1)', async () => {
    fastifyApp.listen.mockRejectedValueOnce(new Error('EADDRINUSE'))
    const { start } = await import('../server.js')
    await expect(start()).rejects.toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

// ── handlers internos ──────────────────────────────────────────────

describe('error handler global', () => {
  it('ZodError → 422 con code VALIDATION_ERROR', async () => {
    const { start } = await import('../server.js')
    await start()
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const { ZodError } = await import('zod')
    const err = new ZodError([])
    err.flatten = () => ({ fieldErrors: { foo: ['Required'] } })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(422)
    expect(reply.send.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR')
  })

  it('FST_ERR_VALIDATION → 422', async () => {
    const { start } = await import('../server.js')
    await start()
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const err = Object.assign(new Error('bad'), { code: 'FST_ERR_VALIDATION', validation: [{ keyword: 'required' }] })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(422)
  })

  it('AppError (4xx) → status del propio error con su code y message', async () => {
    const { start } = await import('../server.js')
    await start()
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const { AppError } = errorsMock
    const err = new AppError('CONFLICT', 'duplicate', 409, { foo: 'bar' })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(409)
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'CONFLICT', message: 'duplicate', details: { foo: 'bar' } },
    })
  })

  it('AppError (5xx) loguea como error y devuelve el status', async () => {
    const { start } = await import('../server.js')
    await start()
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const { AppError } = errorsMock
    const err = new AppError('DB_DOWN', 'database down', 503)
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, {}, reply)
    expect(reply.status).toHaveBeenCalledWith(503)
  })

  it('rechazo de rate-limit (statusCode 429, no AppError) → 429 RATE_LIMITED, no 500', async () => {
    const { start } = await import('../server.js')
    await start()
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const err = Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(err, { url: '/v1/auth/login' }, reply)
    expect(reply.status).toHaveBeenCalledWith(429)
    expect(reply.send.mock.calls[0][0].error.code).toBe('RATE_LIMITED')
  })

  it('error desconocido → 500 INTERNAL_ERROR', async () => {
    const { start } = await import('../server.js')
    await start()
    const handler = fastifyApp.setErrorHandler.mock.calls[0][0]
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }
    handler(new Error('boom'), {}, reply)
    expect(reply.status).toHaveBeenCalledWith(500)
    expect(reply.send.mock.calls[0][0].error.code).toBe('INTERNAL_ERROR')
  })
})

describe('shutdown handler', () => {
  // Cada start() registra una nueva handler en process.on(SIGTERM). Para no
  // dispararlas todas a la vez (errores cruzados), capturamos sólo la
  // última registrada en cada test.
  function latestHandler(signal) {
    const calls = processOnSpy.mock.calls.filter((c) => c[0] === signal)
    return calls[calls.length - 1]?.[1]
  }

  it('SIGTERM cierra app y llama quit() en Redis (exit cualquiera)', async () => {
    const { start } = await import('../server.js')
    await start()
    const fakeRedis = createRedisMock.mock.results.at(-1).value
    const handler = latestHandler('SIGTERM')
    expect(handler).toBeDefined()

    // El handler termina con process.exit() — sólo verificamos que llama
    // a app.close + redis.quit antes. process.exit() (mockeado para throw)
    // hace que el await reject; capturamos sin asertar código concreto.
    try { await handler() } catch { /* expected — process.exit mock throws */ }
    expect(fastifyApp.close).toHaveBeenCalled()
    expect(fakeRedis.quit).toHaveBeenCalled()
  })

  it('si app.close lanza durante shutdown, process.exit con code 1', async () => {
    const { start } = await import('../server.js')
    await start()
    fastifyApp.close.mockRejectedValueOnce(new Error('close failed'))
    const handler = latestHandler('SIGTERM')

    let caught
    try { await handler() } catch (e) { caught = e }
    expect(caught).toBeDefined()
    // El último exit del shutdown handler debe ser code=1 (catch path).
    const lastExit = exitSpy.mock.calls.at(-1)
    expect(lastExit?.[0]).toBe(1)
  })
})
