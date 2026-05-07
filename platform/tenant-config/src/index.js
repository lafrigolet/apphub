import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { appsRoutes } from './routes/apps.routes.js'
import { tenantsRoutes } from './routes/tenants.routes.js'
import { auditRoutes } from './routes/audit.routes.js'
import { startSplitpaySubscriptionSubscriber } from './events/splitpay-subscription.handler.js'

export { runMigrations } from './lib/migrate.js'

let _subscriber = null

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/tenant-config/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'tenant-config', timestamp: new Date().toISOString(),
  }))

  await app.register(appsRoutes)
  await app.register(tenantsRoutes)
  await app.register(auditRoutes)

  // Sync subscription state from splitpay webhooks. Safe to start once;
  // platform-core registers tenant-config a single time per process.
  if (!_subscriber) _subscriber = startSplitpaySubscriptionSubscriber()
}
