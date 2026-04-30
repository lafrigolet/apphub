import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { kdsRoutes } from './routes/kds.routes.js'
import * as service from './services/kds.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/kds/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'kds', timestamp: new Date().toISOString(),
  }))

  await app.register(kdsRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!['order.paid', 'pos.bill.paid'].includes(event.type)) return
      await service.handleEvent(event)
    })
    logger?.info('kds subscribed to order.paid and pos.bill.paid events')
  })
}
