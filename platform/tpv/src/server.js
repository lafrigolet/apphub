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
import * as tpvModule from './index.js'

process.env.DATABASE_URL ??= env.DATABASE_URL_TPV

// Contenedor de módulo único (ADR 015): el orquestador y el módulo tpv
// comparten paquete. Si el dominio crece (customer display, hardware
// bridge, loyalty), los nuevos módulos se añaden aquí como descriptores
// igual que en platform/appointments/src/server.js.
const moduleDescriptors = [
  { name: 'tpv', mod: tpvModule, databaseUrl: env.DATABASE_URL_TPV ?? env.DATABASE_URL },
]

async function start() {
  for (const d of moduleDescriptors) {
    if (typeof d.mod.register !== 'function' || typeof d.mod.runMigrations !== 'function') {
      throw new Error(`Module ${d.name} must export register() and runMigrations()`)
    }
    logger.info({ module: d.name }, 'Running migrations')
    await d.mod.runMigrations(env.MIGRATION_DATABASE_URL)
  }

  const pools = {}
  for (const d of moduleDescriptors) {
    if (!d.databaseUrl) { pools[d.name] = null; continue }
    const pool = createPool(d.databaseUrl)
    pool.on('error', (err) => logger.error({ err, module: d.name }, 'PostgreSQL pool error'))
    pools[d.name] = pool
  }

  const redis = createRedis(env.REDIS_URL)
  redis.on('connect', () => logger.info('Redis connected'))
  redis.on('error', (err) => logger.error({ err }, 'Redis error'))

  // trustProxy: detrás de NGINX (y Cloudflare en prod) la IP real del cliente
  // viaja en X-Forwarded-For; sin esto el rate-limit por IP colapsa en un
  // único bucket compartido.
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
        title: 'platform-tpv',
        description: 'AppHub point-of-sale monolith — devices, cash sessions, receipts, credit notes, X/Z reports, Veri*Factu feed',
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
    service: 'platform-tpv',
    modules: moduleDescriptors.map((d) => d.name),
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

  for (const d of moduleDescriptors) {
    await d.mod.register({
      app,
      db:     pools[d.name],
      redis,
      logger: logger.child({ module: d.name }),
    })
    logger.info({ module: d.name }, 'Module registered')
  }

  try {
    await app.listen({ port: env.PLATFORM_TPV_PORT, host: '0.0.0.0' })
    logger.info({ port: env.PLATFORM_TPV_PORT, env: env.NODE_ENV, modules: moduleDescriptors.map((d) => d.name) }, 'platform-tpv started')
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
  console.error('Failed to start platform-tpv:', err)
  process.exit(1)
})
