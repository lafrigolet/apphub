import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { ZodError } from 'zod'
import Stripe from 'stripe'
import { authPlugin } from './plugins/auth.js'
import { paymentRoutes } from './routes/payment.routes.js'
import { webhookRoutes } from './routes/webhook.routes.js'
import { adminPaymentRoutes } from './routes/admin-payment.routes.js'
import { logger } from './lib/logger.js'
import { AppError } from './utils/errors.js'

export function createApp() {
  const fastify = Fastify({ logger: false })

  fastify.setValidatorCompiler(validatorCompiler)
  fastify.setSerializerCompiler(serializerCompiler)

  fastify.register(helmet)
  fastify.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' })
  fastify.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  })

  // Raw body for Stripe webhooks
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.routeOptions.config?.rawBody) {
      req.rawBody = body
      done(null, JSON.parse(body.toString()))
    } else {
      try { done(null, JSON.parse(body.toString())) } catch (err) { done(err) }
    }
  })

  fastify.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  fastify.register(authPlugin)

  fastify.get('/health', async () => ({
    status: 'ok', service: 'yoga-payments', timestamp: new Date().toISOString(),
  }))

  fastify.register(paymentRoutes, { prefix: '/v1/payments' })
  fastify.register(webhookRoutes, { prefix: '/v1/webhooks' })
  fastify.register(adminPaymentRoutes, { prefix: '/v1/admin/payments' })

  fastify.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      const details = err instanceof ZodError ? err.flatten().fieldErrors : err.validation
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details } })
    }
    if (err instanceof Stripe.errors.StripeError) {
      logger.warn({ stripeCode: err.code, message: err.message }, 'Stripe API error')
      return reply.status(err.statusCode || 502).send({ error: { code: 'STRIPE_ERROR', message: err.message } })
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
