import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { bookingsRoutes } from './routes/bookings.routes.js'
import { startSessionCancelledSubscriber } from './events/session-cancelled.handler.js'
import { startWaitlistPromotionSubscriber } from './events/waitlist-promotion.handler.js'
import { startCommercePaidSubscriber } from './events/commerce-paid.handler.js'

export { runMigrations } from './lib/migrate.js'

let _sub = null
let _waitlistSub = null
let _commerceSub = null

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

  // Subscriber: cuando un slot se libera (booking.cancelled / .rescheduled),
  // promueve la entrada de waitlist más antigua del mismo servicio/recurso y
  // publica booking.waitlist.notified. Cierra el ciclo de waitlist sin
  // intervención manual del staff.
  if (!_waitlistSub) _waitlistSub = startWaitlistPromotionSubscriber()

  // Subscriber: confirma reservas cuyo pago cierra platform/commerce
  // (commerce.purchase.paid, kind=booking).
  if (!_commerceSub) _commerceSub = startCommercePaidSubscriber()

  logger?.info('bookings module ready')
}
