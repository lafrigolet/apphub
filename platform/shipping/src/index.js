import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { shippingRoutes } from './routes/shipping.routes.js'
import * as service from './services/shipping.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/shipping/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'shipping', timestamp: new Date().toISOString(),
  }))

  await app.register(shippingRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type !== 'order.paid') return
      await service.handleEvent(event)
    })
    logger?.info('shipping subscribed to order.paid')
  })
}
