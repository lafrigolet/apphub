import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { deliveryDispatchRoutes } from './routes/delivery-dispatch.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import * as service from './services/delivery-dispatch.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/delivery-dispatch/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'delivery-dispatch', timestamp: new Date().toISOString(),
  }))

  await app.register(deliveryDispatchRoutes)
  await app.register(adminRoutes, { prefix: '/v1/delivery-dispatch/admin' })

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type !== 'order.paid') return
      await service.handleEvent(event)
    })
    logger?.info('delivery-dispatch subscribed to order.paid events')
  })
}
