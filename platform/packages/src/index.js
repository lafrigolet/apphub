import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { packagesRoutes } from './routes/packages.routes.js'
import * as service from './services/packages.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/packages/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'packages', timestamp: new Date().toISOString(),
  }))

  await app.register(packagesRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!['booking.completed', 'booking.cancelled', 'booking.no_show'].includes(event.type)) return
      await service.handleEvent(event)
    })
    logger?.info('packages subscribed to booking lifecycle events')
  })
}
