import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { startEventConsumer } from './services/event-consumer.js'
import { adminRoutes } from './routes/admin.routes.js'
import { emailDomainsRoutes } from './routes/email-domains.routes.js'
import { devicesRoutes } from './routes/devices.routes.js'
import { preferencesRoutes } from './routes/preferences.routes.js'
import { webhooksRoutes } from './routes/webhooks.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/notifications/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'notifications', timestamp: new Date().toISOString(),
  }))

  await app.register(adminRoutes,        { prefix: '/v1/notifications/admin' })
  await app.register(emailDomainsRoutes, { prefix: '/v1/notifications/email-domains' })
  await app.register(devicesRoutes,      { prefix: '/v1/notifications/devices' })
  await app.register(preferencesRoutes,  { prefix: '/v1/notifications' })
  await app.register(webhooksRoutes,     { prefix: '/v1/notifications/webhooks' })

  // Start the platform event consumer once Fastify finishes plugin registration.
  // The consumer creates its own Redis subscriber connection (pub/sub requires
  // a dedicated connection) — it does not share the injected redis client.
  app.addHook('onReady', async () => {
    startEventConsumer()
  })
}
