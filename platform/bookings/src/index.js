import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { bookingsRoutes } from './routes/bookings.routes.js'
import { startSessionCancelledSubscriber } from './events/session-cancelled.handler.js'

export { runMigrations } from './lib/migrate.js'

let _sub = null

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/bookings/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'bookings', timestamp: new Date().toISOString(),
  }))

  await app.register(bookingsRoutes)

  // Subscriber: cuando un service_session se cancela, las bookings
  // ligadas quedan colgantes. Las cancelamos en masa aquí. Single-fire
  // per process — platform-appointments registra bookings una vez.
  if (!_sub) _sub = startSessionCancelledSubscriber()

  logger?.info('bookings module ready')
}
