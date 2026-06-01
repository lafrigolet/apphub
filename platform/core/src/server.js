import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import { createPool, ensureModuleRole } from '@apphub/platform-sdk/db'
import { createRedis } from '@apphub/platform-sdk/redis'
import { AppError } from '@apphub/platform-sdk/errors'
import { appGuard } from '@apphub/platform-sdk/app-guard'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'

// Auth module's env.js validates DATABASE_URL. Set it from the per-module URL
// BEFORE importing the module. configurePool() then injects the real pool below.
process.env.DATABASE_URL ??= env.DATABASE_URL_AUTH

// schema: el namespace PostgreSQL que cada módulo posee. ensureModuleRole
// lo usa al final de cada arranque para reconciliar GRANTs sobre el rol
// dedicado del módulo (CLAUDE.md rule #11). NB: tenant-config vive en
// platform_tenants (histórico) y splitpay en splitpay_core (legacy shared).
const moduleDescriptors = [
  { name: 'auth',          package: '@apphub/platform-auth',          databaseUrl: env.DATABASE_URL_AUTH,          schema: 'platform_auth'          },
  { name: 'notifications', package: '@apphub/platform-notifications', databaseUrl: env.DATABASE_URL_NOTIFICATIONS, schema: 'platform_notifications' },
  { name: 'payments',      package: '@apphub/platform-payments',      databaseUrl: env.DATABASE_URL_PAYMENTS,      schema: 'platform_payments'      },
  { name: 'tenant-config', package: '@apphub/platform-tenant-config', databaseUrl: env.DATABASE_URL_TENANT_CONFIG, schema: 'platform_tenants'       },
  { name: 'splitpay',      package: '@apphub/platform-splitpay',      databaseUrl: env.DATABASE_URL_SPLITPAY,      schema: 'splitpay_core'          },
  { name: 'storage',       package: '@apphub/platform-storage',       databaseUrl: env.DATABASE_URL_STORAGE,       schema: 'platform_storage'       },
  { name: 'leads',         package: '@apphub/platform-leads',         databaseUrl: env.DATABASE_URL_LEADS,         schema: 'platform_leads'         },
  { name: 'donations',     package: '@apphub/platform-donations',     databaseUrl: env.DATABASE_URL_DONATIONS,     schema: 'platform_donations'     },
  { name: 'inquiries',     package: '@apphub/platform-inquiries',     databaseUrl: env.DATABASE_URL_INQUIRIES,     schema: 'platform_inquiries'     },
  { name: 'verifactu',     package: '@apphub/platform-verifactu',     databaseUrl: env.DATABASE_URL_VERIFACTU,     schema: 'platform_verifactu'     },
]

async function loadModule(descriptor) {
  const mod = await import(descriptor.package)
  if (typeof mod.register !== 'function' || typeof mod.runMigrations !== 'function') {
    throw new Error(`Module ${descriptor.name} must export register() and runMigrations()`)
  }
  return mod
}

export async function start() {
  const modules = []
  for (const d of moduleDescriptors) {
    const mod = await loadModule(d)
    modules.push({ descriptor: d, mod })
  }

  // 1. Run migrations for every module against the superuser URL, then
  //    reconcile its dedicated DB role + grants (idempotent — no-op on
  //    healthy environments; recovers from the missing-role drift when a
  //    new module is added to a long-lived postgres volume).
  for (const { descriptor, mod } of modules) {
    logger.info({ module: descriptor.name }, 'Running migrations')
    await mod.runMigrations(env.MIGRATION_DATABASE_URL)
    await ensureModuleRole(env.MIGRATION_DATABASE_URL, {
      schema:      descriptor.schema,
      databaseUrl: descriptor.databaseUrl,
    })
  }

  // 2. Create one Pool per module, bound to its dedicated DB role
  const pools = {}
  for (const { descriptor } of modules) {
    const pool = createPool(descriptor.databaseUrl)
    pool.on('error', (err) => logger.error({ err, module: descriptor.name }, 'PostgreSQL pool error'))
    pools[descriptor.name] = pool
  }

  // 3. Single Redis client shared across modules
  const redis = createRedis(env.REDIS_URL)
  redis.on('connect', () => logger.info('Redis connected'))
  redis.on('error', (err) => logger.error({ err }, 'Redis error'))

  // 4. Root Fastify app — register cross-cutting plugins ONCE
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(helmet)
  await app.register(cors, { origin: env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })

  // OpenAPI: register before modules so their routes are included in the spec.
  // Swagger UI is mounted at /docs (appGuard bypasses /docs/*).
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'platform-core',
        description: 'AppHub modular monolith — auth, notifications, payments, tenant-config, splitpay',
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

  await app.register(appGuard)

  app.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  app.get('/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'platform-core',
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
    // @fastify/rate-limit rejects with statusCode 429 but is not an AppError;
    // honor it instead of masking it as a generic 500.
    if (err.statusCode === 429) {
      logger.warn({ url: req.url }, 'Rate limited')
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } })
    }
    logger.error({ err }, 'Unhandled error')
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
  })

  // 5. Register each module — inject its own pool, the shared redis, and a child logger
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
    await app.listen({ port: env.PLATFORM_CORE_PORT, host: '0.0.0.0' })
    logger.info({ port: env.PLATFORM_CORE_PORT, env: env.NODE_ENV, modules: modules.map((m) => m.descriptor.name) }, 'platform-core started')
  } catch (err) {
    logger.error({ err }, 'Failed to start')
    process.exit(1)
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    try {
      await app.close()
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
  process.on('SIGINT', () => shutdown('SIGINT'))
}

// El bootstrap real (auto-arranque cuando se ejecuta `node src/bootstrap.js`)
// vive en src/bootstrap.js. Aquí sólo exportamos `start()` — los tests
// importan este módulo y controlan la inicialización con mocks sin
// disparar el listen() del top-level.
