import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { servicesRoutes } from './routes/services.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/services/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'services', timestamp: new Date().toISOString(),
  }))

  await app.register(servicesRoutes)
  logger?.info('services module ready')
}
