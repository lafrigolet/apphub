import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import { authRoutes, internalRoutes } from './routes/auth.routes.js'
import { oauthRoutes } from './routes/oauth.routes.js'
import { usersRoutes } from './routes/users.routes.js'
import { appGuard } from './plugins/app-guard.js'
import { logger } from './lib/logger.js'
import { AppError } from './utils/errors.js'

export function createApp() {
  const fastify = Fastify({ logger: false, ignoreTrailingSlash: true })

  fastify.setValidatorCompiler(validatorCompiler)
  fastify.setSerializerCompiler(serializerCompiler)

  fastify.register(helmet)
  fastify.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  fastify.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })

  fastify.register(appGuard)

  fastify.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  fastify.get('/health', { config: { public: true } }, async () => ({
    status: 'ok', service: 'platform-auth', timestamp: new Date().toISOString(),
  }))

  fastify.register(authRoutes, { prefix: '/v1/auth' })
  fastify.register(oauthRoutes, { prefix: '/v1/auth/oauth' })
  fastify.register(usersRoutes)
  fastify.register(internalRoutes, { prefix: '/internal' })

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
