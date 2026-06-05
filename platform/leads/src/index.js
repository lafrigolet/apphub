import { publicRoutes, adminRoutes } from './routes/leads.routes.js'
import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { startEventConsumer } from './services/event-consumer.js'
import { logger } from './lib/logger.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  // Inbound email capture (notifications §26): leads@… → lead.
  const consumer = startEventConsumer({ redis, logger })
  if (consumer) {
    app.addHook('onClose', async () => { try { consumer.disconnect() } catch { /* shutting down */ } })
  }

  app.get('/api/leads/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'leads', timestamp: new Date().toISOString(),
  }))

  await app.register(publicRoutes, { prefix: '/v1/leads' })
  await app.register(adminRoutes,  { prefix: '/v1/leads/admin' })
}
