import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { adminRoutes } from './routes/admin.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/payments/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'payments', timestamp: new Date().toISOString(),
  }))

  await app.register(adminRoutes, { prefix: '/v1/payments/admin' })
  // Stripe gateway, webhooks, transfers will land here as the module is
  // built out. For now we expose only the admin/config surface so staff
  // can prepare the Stripe credentials before any transactional traffic.
}
