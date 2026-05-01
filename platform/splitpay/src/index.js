import { ZodError } from 'zod'
import Stripe from 'stripe'
import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { AppError } from './utils/errors.js'
import { splitRuleRoutes } from './routes/split-rule.routes.js'
import { paymentRoutes } from './routes/payment.routes.js'
import { connectAccountRoutes } from './routes/connect-account.routes.js'
import { webhookRoutes } from './routes/webhook.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import { reloadStripeFromDb } from './lib/stripe.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  // Encapsulate splitpay routes so the Stripe-aware error handler and the raw
  // body content-type parser apply ONLY to /v1/splitpay/*, not to other modules
  // hosted by platform-core.
  await app.register(async (splitpay) => {
    // Routes/services use req.tenant.{tenantId,subTenantId,appId} as the scope
    // context. appGuard decorates req.identity instead — alias it here so the
    // splitpay routes work unchanged. Skips the alias for unauthenticated
    // contexts (health, webhooks) to avoid undefined access.
    splitpay.decorateRequest('tenant', null)
    splitpay.addHook('preHandler', async (req) => {
      if (!req.identity) return

      // Staff impersonation: super_admin / staff can scope the request to any
      // tenant via ?appId=&tenantId= query params. Used by voragine-console's
      // TenantDetail to manage splitpay configuration on behalf of a tenant.
      // Regular users can never override their own tenant.
      const STAFF_ROLES = new Set(['staff', 'super_admin'])
      const canImpersonate = STAFF_ROLES.has(req.identity.role)
      const overrideTenantId = canImpersonate ? req.query?.tenantId : null
      const overrideAppId    = canImpersonate ? req.query?.appId    : null

      req.tenant = {
        appId:        overrideAppId    ?? req.identity.appId,
        tenantId:     overrideTenantId ?? req.identity.tenantId,
        subTenantId:  req.identity.subTenantId ?? null,
        impersonated: !!overrideTenantId,
      }
    })

    // Raw body for Stripe webhook signature verification. Other routes get the
    // standard JSON parse — gated by routeOptions.config.rawBody.
    splitpay.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      if (req.routeOptions.config?.rawBody) {
        req.rawBody = body
        done(null, JSON.parse(body.toString()))
      } else {
        try { done(null, JSON.parse(body.toString())) }
        catch (err) { done(err) }
      }
    })

    splitpay.setErrorHandler((err, req, reply) => {
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
      logger.error({ err }, 'Unhandled error in splitpay')
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
    })

    splitpay.get('/api/splitpay/health', { config: { public: true } }, async () => ({
      status: 'ok', module: 'splitpay', timestamp: new Date().toISOString(),
    }))

    await splitpay.register(splitRuleRoutes,      { prefix: '/v1/splitpay/split-rules' })
    await splitpay.register(paymentRoutes,        { prefix: '/v1/splitpay/payments' })
    await splitpay.register(connectAccountRoutes, { prefix: '/v1/splitpay/connect-accounts' })
    await splitpay.register(webhookRoutes,        { prefix: '/v1/splitpay/webhooks' })
    await splitpay.register(adminRoutes,          { prefix: '/v1/splitpay/admin' })
  })

  // Hydrate Stripe credentials from DB at boot. If neither DB nor env has
  // them yet, the lazy fallback in stripe.js logs a warning and the first
  // request fails gracefully (staff sets the keys via voragine-console
  // and PATCH /v1/splitpay/admin/config reloads the Stripe client).
  app.addHook('onReady', async () => {
    try { await reloadStripeFromDb() } catch (err) { logger.warn({ err }, 'splitpay: deferred Stripe init') }
  })
}
