import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { reservationsRoutes } from './routes/reservations.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/reservations/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'reservations', timestamp: new Date().toISOString(),
  }))

  await app.register(reservationsRoutes)
  logger?.info('reservations module ready')
}
