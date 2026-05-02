import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { appsRoutes } from './routes/apps.routes.js'
import { tenantsRoutes } from './routes/tenants.routes.js'
import { auditRoutes } from './routes/audit.routes.js'
import { backfillTenantNginxConfigs } from './services/tenants.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/tenant-config/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'tenant-config', timestamp: new Date().toISOString(),
  }))

  await app.register(appsRoutes)
  await app.register(tenantsRoutes)
  await app.register(auditRoutes)

  // Backfill NGINX subdomain → tenant-console map for every active tenant.
  // Runs after route registration; if Redis is down we log and continue —
  // the operator can re-trigger via a platform-core restart.
  try {
    const count = await backfillTenantNginxConfigs()
    logger?.info?.({ count }, 'Tenant NGINX backfill complete')
  } catch (err) {
    logger?.warn?.({ err }, 'Tenant NGINX backfill failed (non-fatal)')
  }
}
