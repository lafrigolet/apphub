// Factoría standalone del app — la usan los tests de integración (y
// cualquier consumidor que quiera el Fastify completo sin listen()).
// Desde ADR 018 es un envoltorio fino sobre el contrato de módulo
// (src/index.js). En producción el módulo corre dentro del orquestador
// apps-servers.
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import { ZodError } from 'zod'
import { AppError } from '@apphub/platform-sdk/errors'
import { logger } from './lib/logger.js'
import { register } from './index.js'

export async function createApp() {
  const fastify = Fastify({ logger: false, ignoreTrailingSlash: true })

  await fastify.register(helmet)
  await fastify.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  await fastify.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })
  await fastify.register(sensible)

  fastify.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  // Health is public — gateway hits it for liveness, no JWT involved.
  fastify.get('/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'aulavera-server',
    timestamp: new Date().toISOString(),
  }))

  fastify.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  fastify.setErrorHandler((err, req, reply) => {
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

  // db: null → lib/db.js crea el pool desde DATABASE_URL.
  await register({ app: fastify, db: null, redis: null, logger })

  return fastify
}
