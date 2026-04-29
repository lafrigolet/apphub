import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { itemsRoutes } from './routes/items.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/catalog/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'catalog', timestamp: new Date().toISOString(),
  }))

  await app.register(itemsRoutes)
}
