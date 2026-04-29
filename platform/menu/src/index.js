import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { menuRoutes } from './routes/menu.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/menu/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'menu', timestamp: new Date().toISOString(),
  }))

  await app.register(menuRoutes)
  logger?.info('menu module ready')
}
