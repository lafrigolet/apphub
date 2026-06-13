import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { commerceRoutes } from './routes/commerce.routes.js'
import * as service from './services/commerce.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/commerce/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'commerce', timestamp: new Date().toISOString(),
  }))

  await app.register(commerceRoutes)

  // Orquestación: al cobrarse/fallar un pago, casamos el checkout y disparamos
  // (o cancelamos) el fulfillment. Los módulos dueños (packages/bookings)
  // consumen `commerce.purchase.paid`.
  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!['payment.succeeded', 'payment.failed'].includes(event.type)) return
      try { await service.handlePaymentEvent(event) }
      catch (err) { logger?.error({ err, type: event.type }, 'commerce: fallo procesando evento de pago') }
    })
    logger?.info('commerce subscribed to payment events')
  })
}
