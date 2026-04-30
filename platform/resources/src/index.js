import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { resourcesRoutes } from './routes/resources.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/resources/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'resources', timestamp: new Date().toISOString(),
  }))

  await app.register(resourcesRoutes)
  logger?.info('resources module ready')
}
