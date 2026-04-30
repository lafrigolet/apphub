import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { availabilityRoutes } from './routes/availability.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/availability/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'availability', timestamp: new Date().toISOString(),
  }))

  await app.register(availabilityRoutes)
  logger?.info('availability module ready')
}
