import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { posRoutes } from './routes/pos.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/pos/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'pos', timestamp: new Date().toISOString(),
  }))

  await app.register(posRoutes)
  logger?.info('pos module ready')
}
