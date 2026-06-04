import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { floorPlanRoutes } from './routes/floor-plan.routes.js'
import * as service from './services/floor-plan.service.js'

export { runMigrations } from './lib/migrate.js'

// Reservation + POS lifecycle events that drive table state automatically.
const SYNCED_EVENTS = new Set([
  'reservation.confirmed', 'reservation.cancelled', 'reservation.seated',
  'pos.bill.opened', 'pos.bill.closed', 'pos.bill.paid',
])

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/floor-plan/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'floor-plan', timestamp: new Date().toISOString(),
  }))

  await app.register(floorPlanRoutes)

  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (!SYNCED_EVENTS.has(event.type)) return
      await service.handleEvent(event)
    })
    logger?.info('floor-plan subscribed to reservation.* and pos.bill.* events')
  })

  logger?.info('floor-plan module ready')
}
