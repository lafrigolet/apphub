import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { floorPlanRoutes } from './routes/floor-plan.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/floor-plan/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'floor-plan', timestamp: new Date().toISOString(),
  }))

  await app.register(floorPlanRoutes)
  logger?.info('floor-plan module ready')
}
