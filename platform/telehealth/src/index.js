import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { telehealthRoutes } from './routes/telehealth.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import * as service from './services/telehealth.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/telehealth/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'telehealth', timestamp: new Date().toISOString(),
  }))

  await app.register(telehealthRoutes)
  await app.register(adminRoutes, { prefix: '/v1/telehealth/admin' })

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type !== 'booking.confirmed') return
      await service.handleEvent(event)
    })
    logger?.info('telehealth subscribed to booking.confirmed events')
  })
}
