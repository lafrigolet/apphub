import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'

import { splitRuleRoutes } from './routes/split-rule.routes.js'
import { paymentRoutes } from './routes/payment.routes.js'
import { connectAccountRoutes } from './routes/connect-account.routes.js'
import { webhookRoutes } from './routes/webhook.routes.js'
import { tenantPlugin } from './plugins/tenant.js'
import { logger } from './lib/logger.js'
import { AppError } from './utils/errors.js'
import { ZodError } from 'zod'
import Stripe from 'stripe'

export function createApp() {
  const fastify = Fastify({
    logger: false, // We use our own pino logger
  })

  // Zod Type Provider
  fastify.setValidatorCompiler(validatorCompiler)
  fastify.setSerializerCompiler(serializerCompiler)

  // Security headers
  fastify.register(helmet)

  // CORS
  fastify.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
  })

  // Rate limiting
  fastify.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
    }),
  })

  // Raw body parsing for Stripe webhooks
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.routeOptions.config?.rawBody) {
      req.rawBody = body
      done(null, JSON.parse(body.toString()))
    } else {
      try {
        done(null, JSON.parse(body.toString()))
      } catch (err) {
        done(err)
      }
    }
  })

  // Request logging
  fastify.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming request')
  })

  // Tenant Context
  fastify.register(tenantPlugin)

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'split-payments', timestamp: new Date().toISOString() }
  })

  // API routes
  fastify.register(splitRuleRoutes, { prefix: '/v1/split-rules' })
  fastify.register(paymentRoutes, { prefix: '/v1/payments' })
  fastify.register(connectAccountRoutes, { prefix: '/v1/connect-accounts' })
  fastify.register(webhookRoutes, { prefix: '/v1/webhooks' })

  // 404 handler
  fastify.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  // Error handler
  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      const details = err instanceof ZodError ? err.flatten().fieldErrors : err.validation
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details,
        },
      })
    }

    if (err instanceof Stripe.errors.StripeError) {
      logger.warn({ stripeCode: err.code, message: err.message }, 'Stripe API error')
      return reply.status(err.statusCode || 502).send({
        error: { code: 'STRIPE_ERROR', message: err.message },
      })
    }

    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        logger.error({ err, code: err.code }, err.message)
      } else {
        logger.warn({ code: err.code, message: err.message }, 'Client error')
      }
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      })
    }

    // Fastify native errors (like 404)
    if (err.statusCode === 404) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
    }

    logger.error({ err }, 'Unhandled error')
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    })
  })

  return fastify
}
