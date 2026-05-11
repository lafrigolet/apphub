import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import { ZodError } from 'zod'
import { appGuard } from '@apphub/platform-sdk/app-guard'
import { AppError } from '@apphub/platform-sdk/errors'
import { logger } from './lib/logger.js'
import { membersRoutes }      from './routes/members.routes.js'
import { videosRoutes }       from './routes/videos.routes.js'
import { dojosRoutes }        from './routes/dojos.routes.js'
import { feesRoutes }         from './routes/fees.routes.js'
import { certificatesRoutes } from './routes/certificates.routes.js'
// events + event-registrations: deprecated tras cutover Fase 2. La
// agenda se sirve desde platform-appointments (services + sessions)
// y las inscripciones desde platform/bookings (sessionId). Los routes
// dejan de registrarse; cualquier cliente legacy recibe 404 y debe
// migrar al nuevo endpoint. Las tablas siguen vivas (migration 0009
// marca COMMENT DEPRECATED) hasta confirmar que no quedan callers.

export function createApp() {
  const fastify = Fastify({ logger: false, ignoreTrailingSlash: true })

  fastify.register(helmet)
  fastify.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  fastify.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })
  fastify.register(sensible)
  fastify.register(appGuard)

  fastify.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  // Health is public — gateway hits it for liveness, no JWT involved.
  fastify.get('/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'aikikan-server',
    timestamp: new Date().toISOString(),
  }))

  // Mirror /health on the /v1/aikikan/health path so the gateway snippet
  // (which proxies /api/aikikan/* → /v1/aikikan/*) reaches it without
  // path rewriting gymnastics.
  fastify.get('/v1/aikikan/health', { config: { public: true } }, async () => ({
    status: 'ok',
    service: 'aikikan-server',
    timestamp: new Date().toISOString(),
  }))

  fastify.register(membersRoutes)
  fastify.register(videosRoutes)
  fastify.register(dojosRoutes)
  fastify.register(feesRoutes)
  fastify.register(certificatesRoutes)

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

  return fastify
}
