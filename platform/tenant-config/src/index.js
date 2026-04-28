import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { appsRoutes } from './routes/apps.routes.js'
import { tenantsRoutes } from './routes/tenants.routes.js'
import { auditRoutes } from './routes/audit.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/tenant-config/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'tenant-config', timestamp: new Date().toISOString(),
  }))

  await app.register(appsRoutes)
  await app.register(tenantsRoutes)
  await app.register(auditRoutes)
}
