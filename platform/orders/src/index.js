import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { ordersRoutes } from './routes/orders.routes.js'
import * as service from './services/orders.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/orders/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'orders', timestamp: new Date().toISOString(),
  }))

  await app.register(ordersRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!['splitpay.payment.completed', 'shipping.shipment.delivered'].includes(event.type)) return
      await service.handleEvent(event)
    })
    logger?.info('orders subscribed to splitpay.* and shipping.* events')
  })
}
