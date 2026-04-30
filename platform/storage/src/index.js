import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { storageRoutes } from './routes/storage.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/storage/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'storage', timestamp: new Date().toISOString(),
  }))

  await app.register(storageRoutes)
  logger?.info('storage module ready')
}
