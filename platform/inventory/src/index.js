import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { inventoryRoutes } from './routes/inventory.routes.js'
import * as service from './services/inventory.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/inventory/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'inventory', timestamp: new Date().toISOString(),
  }))

  await app.register(inventoryRoutes)

  // Subscribe to order lifecycle events on platform.events. The subscriber
  // creates its own dedicated Redis connection (pub/sub requires that).
  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!['order.created', 'order.paid', 'order.cancelled'].includes(event.type)) return
      await service.handleOrderEvent(event)
    })
    logger?.info('inventory subscribed to order.* events')
  })
}
