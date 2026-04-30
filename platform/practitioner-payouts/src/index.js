import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { payoutsRoutes } from './routes/practitioner-payouts.routes.js'
import * as service from './services/practitioner-payouts.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/practitioner-payouts/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'practitioner-payouts', timestamp: new Date().toISOString(),
  }))

  await app.register(payoutsRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type === 'payout.period_due') {
        await service.handleScheduledPayout(event)
        return
      }
      if (!['booking.completed', 'booking.cancelled', 'booking.no_show'].includes(event.type)) return
      await service.handleEvent(event)
    })
    logger?.info('practitioner-payouts subscribed to booking.* + payout.period_due')
  })
}
