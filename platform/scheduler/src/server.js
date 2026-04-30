import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import cron from 'node-cron'
import { createPool } from '@apphub/platform-sdk/db'
import { createRedis } from '@apphub/platform-sdk/redis'
import { AppError } from '@apphub/platform-sdk/errors'
import { appGuard } from '@apphub/platform-sdk/app-guard'

import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { configurePool, pool } from './lib/db.js'
import { configureRedis, redis } from './lib/redis.js'
import { runMigrations } from './lib/migrate.js'
import { jobRunner } from './lib/job-runner.js'
import { jobs } from './jobs/index.js'
import { adminRoutes } from './routes/admin.routes.js'

async function start() {
  // 1. Migrations — same superuser pattern as the other monoliths.
  logger.info('Running migrations')
  await runMigrations(env.MIGRATION_DATABASE_URL)

  // 2. Pool + Redis bound to svc_platform_scheduler.
  const realPool = createPool(env.DATABASE_URL)
  realPool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'))
  configurePool(realPool)

  const realRedis = createRedis(env.REDIS_URL)
  realRedis.on('connect', () => logger.info('Redis connected'))
  realRedis.on('error', (err) => logger.error({ err }, 'Redis error'))
  configureRedis(realRedis)

  // 3. Tiny Fastify app — only /health (public) and admin endpoints.
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  await app.register(helmet)
  await app.register(cors, { origin: env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })
  await app.register(appGuard)

  app.get('/health', { config: { public: true } }, async () => ({
    status:    'ok',
    service:   'platform-scheduler',
    jobs:      jobs.map((j) => ({ name: j.meta.name, enabled: j.enabled })),
    timestamp: new Date().toISOString(),
  }))

  await app.register((f, _opts, done) => {
    adminRoutes(f, { jobs, jobRunner, pool })
    done()
  })

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      const details = err instanceof ZodError ? err.flatten().fieldErrors : err.validation
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details } })
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } })
    }
    logger.error({ err }, 'Unhandled error')
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
  })

  // 4. Schedule cron jobs after the HTTP server is ready (so /health and the
  // admin endpoint are responding before the first tick fires).
  const cronTasks = []
  app.addHook('onReady', async () => {
    for (const j of jobs) {
      if (!j.enabled) {
        logger.info({ job: j.meta.name }, 'job disabled by env flag')
        continue
      }
      const task = cron.schedule(j.meta.cron, () => jobRunner(j.meta, j.run), { scheduled: true })
      cronTasks.push(task)
      logger.info({ job: j.meta.name, cron: j.meta.cron }, 'job scheduled')
    }
  })

  try {
    await app.listen({ port: env.PLATFORM_SCHEDULER_PORT, host: '0.0.0.0' })
    logger.info({ port: env.PLATFORM_SCHEDULER_PORT, env: env.NODE_ENV, jobs: jobs.length }, 'platform-scheduler started')
  } catch (err) {
    logger.error({ err }, 'Failed to start')
    process.exit(1)
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    try {
      for (const t of cronTasks) t.stop()
      await app.close()
      await realPool.end()
      await realRedis.quit()
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
  console.error('Failed to start platform-scheduler:', err)
  process.exit(1)
})
