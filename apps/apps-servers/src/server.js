// apps-servers — orquestador de TODOS los servidores específicos de app
// (ADR 018). Un solo proceso Fastify en un puerto; cada app-server se
// registra como módulo (contrato register/runMigrations, igual que los
// monolitos platform-*) con su Pool ligado a su rol svc_app_<app> y su
// guard de app_id POR SCOPE — NO se registra el appGuard global del SDK:
// con varios apps en un proceso, cada scope valida su propio app_id
// (regla 2 de CLAUDE.md: un token de aikikan jamás toca rutas de aulavera).
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import { ZodError } from 'zod'
import { createPool, ensureModuleRole } from '@apphub/platform-sdk/db'
import { createRedis } from '@apphub/platform-sdk/redis'
import { AppError } from '@apphub/platform-sdk/errors'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'

const moduleDescriptors = [
  { name: 'aikikan',  package: '@aikikan/aikikan-server',   databaseUrl: env.DATABASE_URL_AIKIKAN,  schema: 'app_aikikan'  },
  { name: 'aulavera', package: '@aulavera/aulavera-server', databaseUrl: env.DATABASE_URL_AULAVERA, schema: 'app_aulavera' },
]

async function loadModule(descriptor) {
  const mod = await import(descriptor.package)
  if (typeof mod.register !== 'function' || typeof mod.runMigrations !== 'function') {
    throw new Error(`Module ${descriptor.name} must export register() and runMigrations()`)
  }
  return mod
}

async function start() {
  const modules = []
  for (const d of moduleDescriptors) {
    const mod = await loadModule(d)
    modules.push({ descriptor: d, mod })
  }

  // 1. Migraciones + reconciliación del rol dedicado (idempotente), y el
  //    hook opcional enforceGrants DESPUÉS (ver ADR 016 / CONVENTIONS.md).
  for (const { descriptor, mod } of modules) {
    logger.info({ module: descriptor.name }, 'Running migrations')
    await mod.runMigrations(env.MIGRATION_DATABASE_URL)
    await ensureModuleRole(env.MIGRATION_DATABASE_URL, {
      schema:      descriptor.schema,
      databaseUrl: descriptor.databaseUrl,
    })
    if (typeof mod.enforceGrants === 'function') {
      await mod.enforceGrants(env.MIGRATION_DATABASE_URL)
    }
  }

  // 2. Un Pool por app, ligado a su rol svc_app_<app>
  const pools = {}
  for (const { descriptor } of modules) {
    const pool = createPool(descriptor.databaseUrl)
    pool.on('error', (err) => logger.error({ err, module: descriptor.name }, 'PostgreSQL pool error'))
    pools[descriptor.name] = pool
  }

  // 3. Redis compartido (los suscriptores pub/sub de cada app crean su
  //    propia conexión — pub/sub no multiplexa)
  const redis = createRedis(env.REDIS_URL)
  redis.on('connect', () => logger.info('Redis connected'))
  redis.on('error', (err) => logger.error({ err }, 'Redis error'))

  // 4. Fastify raíz — plugins transversales UNA vez
  const app = Fastify({ logger: false, ignoreTrailingSlash: true, trustProxy: true })

  await app.register(helmet)
  await app.register(cors, { origin: env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })
  await app.register(sensible)

  app.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  app.get('/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'apps-servers',
    modules: modules.map((m) => m.descriptor.name),
    timestamp: new Date().toISOString(),
  }))

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      const details = err instanceof ZodError ? err.flatten().fieldErrors : err.validation
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details } })
    }
    if (err instanceof AppError) {
      if (err.statusCode >= 500) logger.error({ err, code: err.code }, err.message)
      else logger.warn({ code: err.code, message: err.message }, 'Client error')
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } })
    }
    logger.error({ err }, 'Unhandled error')
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
  })

  // 5. Registrar cada app-server: pool propio, redis compartido, child logger
  for (const { descriptor, mod } of modules) {
    await mod.register({
      app,
      db:     pools[descriptor.name],
      redis,
      logger: logger.child({ module: descriptor.name }),
    })
    logger.info({ module: descriptor.name }, 'Module registered')
  }

  try {
    await app.listen({ port: env.APPS_SERVERS_PORT, host: '0.0.0.0' })
    logger.info({ port: env.APPS_SERVERS_PORT, env: env.NODE_ENV, modules: modules.map((m) => m.descriptor.name) }, 'apps-servers started')
  } catch (err) {
    logger.error({ err }, 'Failed to start')
    process.exit(1)
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    try {
      await app.close() // onClose de cada módulo cierra sus suscriptores
      await Promise.all(Object.values(pools).map((p) => p.end()))
      await redis.quit()
      logger.info('Graceful shutdown complete')
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Error during shutdown')
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

start().catch((err) => {
  console.error('Failed to start apps-servers:', err)
  process.exit(1)
})
