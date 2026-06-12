import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { shippingRoutes, returnsRoutes } from './routes/shipping.routes.js'
import { easypostRoutes } from './routes/easypost.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import { reloadEasyPostFromDb } from './lib/easypost.js'
import * as service from './services/shipping.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/shipping/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'shipping', timestamp: new Date().toISOString(),
  }))

  await app.register(shippingRoutes)
  await app.register(returnsRoutes)
  await app.register(easypostRoutes)
  await app.register(adminRoutes, { prefix: '/v1/shipping/admin' })

  app.addHook('onReady', async () => {
    // Load EasyPost credentials from the DB (env fallback). Re-loaded after a
    // config PATCH so staff can enable the carrier integration without a redeploy.
    await reloadEasyPostFromDb().catch((err) => logger?.warn({ err }, 'EasyPost initial load failed'))
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type !== 'order.paid') return
      await service.handleEvent(event)
    })
    logger?.info('shipping subscribed to order.paid')
  })
}
