import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { intakeFormsRoutes } from './routes/intake-forms.routes.js'
import * as service from './services/intake-forms.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/intake-forms/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'intake-forms', timestamp: new Date().toISOString(),
  }))

  await app.register(intakeFormsRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!['booking.confirmed', 'booking.requested'].includes(event.type)) return
      await service.handleEvent(event)
    })
    logger?.info('intake-forms subscribed to booking.* events')
  })
}
