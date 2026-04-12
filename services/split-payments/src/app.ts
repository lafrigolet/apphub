import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import { splitRuleRouter } from './routes/split-rule.routes.js'
import { paymentRouter } from './routes/payment.routes.js'
import { connectAccountRouter } from './routes/connect-account.routes.js'
import { webhookRouter } from './routes/webhook.routes.js'
import { errorHandler } from './middleware/error.middleware.js'
import { logger } from './lib/logger.js'

export function createApp(): express.Express {
  const app = express()

  // Security headers
  app.use(helmet())

  // CORS — tighten origins in production via env
  app.use(cors({ origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? '*' }))

  // Raw body for Stripe webhooks (must come BEFORE json middleware)
  app.use('/v1/webhooks', express.raw({ type: 'application/json' }))

  // JSON body parser for all other routes
  app.use(express.json())

  // Rate limiting
  app.use(
    '/v1',
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
        })
      },
    }),
  )

  // Request logging
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, path: req.path }, 'Incoming request')
    next()
  })

  // Health check (no auth required)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'split-payments', timestamp: new Date().toISOString() })
  })

  // API routes
  app.use('/v1/split-rules', splitRuleRouter)
  app.use('/v1/payments', paymentRouter)
  app.use('/v1/connect-accounts', connectAccountRouter)
  app.use('/v1/webhooks', webhookRouter)

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  // Global error handler (must be last)
  app.use(errorHandler)

  return app
}
