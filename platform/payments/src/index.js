import { ZodError } from 'zod'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { AppError } from '@apphub/platform-sdk/errors'
import { StripeErrors, reloadStripeFromDb } from './lib/stripe.js'
import { adminRoutes } from './routes/admin.routes.js'
import { paymentRoutes } from './routes/payment.routes.js'
import { terminalRoutes } from './routes/terminal.routes.js'
import { checkoutRoutes } from './routes/checkout.routes.js'
import { webhookRoutes } from './routes/webhook.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/payments/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'payments', timestamp: new Date().toISOString(),
  }))

  // Encapsulate payments routes so the raw-body parser and Stripe-aware error
  // handler apply ONLY to /v1/payments/*, never to other platform-core modules.
  await app.register(async (payments) => {
    // Zod type provider: route schemas are zod objects, so the validator and
    // serializer compilers must be set on this encapsulated scope or the schemas
    // are inert (no body validation, broken serialization). Matches splitpay.
    payments.setValidatorCompiler(validatorCompiler)
    payments.setSerializerCompiler(serializerCompiler)

    // Scope context. appGuard decorates req.identity; alias it to req.tenant for
    // the routes/services. Staff/super_admin may impersonate a tenant via
    // ?appId=&tenantId= (used by the admin console). Skipped for public routes
    // (health, webhooks) where req.identity is absent.
    payments.decorateRequest('tenant', null)
    payments.addHook('preHandler', async (req) => {
      if (!req.identity) return
      const STAFF = new Set(['staff', 'super_admin'])
      const canImpersonate = STAFF.has(req.identity.role)
      const overrideTenantId = canImpersonate ? req.query?.tenantId : null
      const overrideAppId = canImpersonate ? req.query?.appId : null
      req.tenant = {
        appId: overrideAppId ?? req.identity.appId,
        tenantId: overrideTenantId ?? req.identity.tenantId,
        subTenantId: req.identity.subTenantId ?? null,
        userId: req.identity.userId,
        impersonated: !!overrideTenantId,
      }
    })

    // Raw body for Stripe webhook signature verification, gated by route config.
    payments.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      if (req.routeOptions.config?.rawBody) {
        req.rawBody = body
        try { done(null, body.length ? JSON.parse(body.toString()) : {}) }
        catch { done(null, {}) } // signature check runs on rawBody, not parsed
      } else {
        try { done(null, body.length ? JSON.parse(body.toString()) : {}) }
        catch (err) { done(err) }
      }
    })

    payments.setErrorHandler((err, req, reply) => {
      if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
        const details = err instanceof ZodError ? err.flatten().fieldErrors : err.validation
        return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details } })
      }
      if (StripeErrors && err instanceof StripeErrors.StripeError) {
        logger.warn({ stripeCode: err.code, message: err.message }, 'Stripe API error')
        return reply.status(err.statusCode || 502).send({ error: { code: 'STRIPE_ERROR', message: err.message } })
      }
      if (err instanceof AppError) {
        if (err.statusCode >= 500) logger.error({ err, code: err.code }, err.message)
        else logger.warn({ code: err.code, message: err.message }, 'Client error')
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } })
      }
      logger.error({ err }, 'Unhandled error in payments')
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
    })

    await payments.register(adminRoutes, { prefix: '/v1/payments/admin' })
    await payments.register(paymentRoutes, { prefix: '/v1/payments' })
    await payments.register(terminalRoutes, { prefix: '/v1/payments/terminal' })
    await payments.register(checkoutRoutes, { prefix: '/v1/payments' })
    await payments.register(webhookRoutes, { prefix: '/v1/payments/webhooks' })
  })

  // Hydrate Stripe credentials from DB at boot. With no key configured the
  // module runs in dev-stub mode (no real charges) until staff sets the key.
  app.addHook('onReady', async () => {
    try { await reloadStripeFromDb() } catch (err) { logger.warn({ err }, 'payments: deferred Stripe init') }
  })
}
