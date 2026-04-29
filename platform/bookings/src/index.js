import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { bookingsRoutes } from './routes/bookings.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/bookings/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'bookings', timestamp: new Date().toISOString(),
  }))

  await app.register(bookingsRoutes)
  logger?.info('bookings module ready')
}
