import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import { appGuard } from '@apphub/platform-sdk/app-guard'
import { logger } from './lib/logger.js'
import { AppError } from '@apphub/platform-sdk/errors'
import { ZodError } from 'zod'
import { startEventConsumer } from './services/event-consumer.js'

export function createApp() {
  const fastify = Fastify({ logger: false })
  fastify.register(helmet)
  fastify.register(cors, { origin: '*' })
  fastify.register(appGuard)

  fastify.get('/health', { config: { public: true } }, async () => ({
    status: 'ok', service: 'platform-notifications', timestamp: new Date().toISOString(),
  }))

  fastify.addHook('onReady', async () => { startEventConsumer() })

  fastify.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      const details = err instanceof ZodError ? err.flatten().fieldErrors : err.validation
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details } })
    }
    if (err instanceof AppError) {
      if (err.statusCode >= 500) logger.error({ err }, err.message)
      else logger.warn({ code: err.code, message: err.message }, 'Client error')
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    logger.error({ err }, 'Unhandled error')
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
  })

  return fastify
}
