import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { disputesRoutes } from './routes/disputes.routes.js'
import * as service from './services/disputes.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/disputes/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'disputes', timestamp: new Date().toISOString(),
  }))

  await app.register(disputesRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type !== 'splitpay.chargeback.created') return
      await service.handleEvent(event)
    })
    logger?.info('disputes subscribed to splitpay.chargeback.created')
  })
}
