import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import { createPool } from '@apphub/platform-sdk/db'
import { createRedis } from '@apphub/platform-sdk/redis'
import { AppError } from '@apphub/platform-sdk/errors'
import { appGuard } from '@apphub/platform-sdk/app-guard'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'

// Each module's env.js validates DATABASE_URL. Set it from any per-module URL
// BEFORE importing the modules. configurePool() then injects the real pool below.
process.env.DATABASE_URL ??= env.DATABASE_URL_MENU

const moduleDescriptors = [
  { name: 'menu',              package: '@apphub/platform-menu',              databaseUrl: env.DATABASE_URL_MENU              },
  { name: 'floor-plan',        package: '@apphub/platform-floor-plan',        databaseUrl: env.DATABASE_URL_FLOOR_PLAN        },
  { name: 'reservations',      package: '@apphub/platform-reservations',      databaseUrl: env.DATABASE_URL_RESERVATIONS      },
  { name: 'kds',               package: '@apphub/platform-kds',               databaseUrl: env.DATABASE_URL_KDS               },
  { name: 'pos',               package: '@apphub/platform-pos',               databaseUrl: env.DATABASE_URL_POS               },
  { name: 'delivery-dispatch', package: '@apphub/platform-delivery-dispatch', databaseUrl: env.DATABASE_URL_DELIVERY_DISPATCH },
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

  // 1. Run migrations for every module against the superuser URL
  for (const { descriptor, mod } of modules) {
    logger.info({ module: descriptor.name }, 'Running migrations')
    await mod.runMigrations(env.MIGRATION_DATABASE_URL)
  }

  // 2. Create one Pool per module, bound to its dedicated DB role.
  const pools = {}
  for (const { descriptor } of modules) {
    if (!descriptor.databaseUrl) {
      pools[descriptor.name] = null
      continue
    }
    const pool = createPool(descriptor.databaseUrl)
    pool.on('error', (err) => logger.error({ err, module: descriptor.name }, 'PostgreSQL pool error'))
    pools[descriptor.name] = pool
  }

  // 3. Single Redis client shared across modules. Same `platform.events` channel
  // as platform-core / platform-marketplace — events cross containers transparently.
  const redis = createRedis(env.REDIS_URL)
  redis.on('connect', () => logger.info('Redis connected'))
  redis.on('error', (err) => logger.error({ err }, 'Redis error'))

  // 4. Root Fastify app — register cross-cutting plugins ONCE
  // trustProxy: detrás de NGINX (y Cloudflare en prod) la IP real del cliente
  // viaja en X-Forwarded-For; sin esto req.ip es la IP del proxy y el
  // rate-limit por IP colapsa en un único bucket compartido.
  const app = Fastify({ logger: false, ignoreTrailingSlash: true, trustProxy: true })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(helmet)
  await app.register(cors, { origin: env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'platform-restaurant',
        description: 'AppHub restaurant monolith — menu, reservations, floor-plan, kds, pos, delivery-dispatch',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  // appGuard validates JWTs signed with PLATFORM_JWT_SECRET (same as platform-core).
  await app.register(appGuard)

  app.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  app.get('/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'platform-restaurant',
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

  // 5. Register each module
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
    await app.listen({ port: env.PLATFORM_RESTAURANT_PORT, host: '0.0.0.0' })
    logger.info({ port: env.PLATFORM_RESTAURANT_PORT, env: env.NODE_ENV, modules: modules.map((m) => m.descriptor.name) }, 'platform-restaurant started')
  } catch (err) {
    logger.error({ err }, 'Failed to start')
    process.exit(1)
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    try {
      await app.close()
      await Promise.all(Object.values(pools).filter(Boolean).map((p) => p.end()))
      await redis.quit()
      logger.info('Graceful shutdown complete')
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start().catch((err) => {
  console.error('Failed to start platform-restaurant:', err)
  process.exit(1)
})
