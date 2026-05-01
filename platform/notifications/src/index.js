import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { startEventConsumer } from './services/event-consumer.js'
import { adminRoutes } from './routes/admin.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/notifications/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'notifications', timestamp: new Date().toISOString(),
  }))

  await app.register(adminRoutes, { prefix: '/v1/notifications/admin' })

  // Start the platform event consumer once Fastify finishes plugin registration.
  // The consumer creates its own Redis subscriber connection (pub/sub requires
  // a dedicated connection) — it does not share the injected redis client.
  app.addHook('onReady', async () => {
    startEventConsumer()
  })
}
