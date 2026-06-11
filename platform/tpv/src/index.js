import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { devicesRoutes } from './routes/devices.routes.js'
import { seriesRoutes } from './routes/series.routes.js'
import { sessionsRoutes } from './routes/sessions.routes.js'
import { billingFactsRoutes } from './routes/billing-facts.routes.js'
import { receiptsRoutes } from './routes/receipts.routes.js'
import { creditNotesRoutes } from './routes/credit-notes.routes.js'
import { reportsRoutes } from './routes/reports.routes.js'
import { settingsRoutes } from './routes/settings.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import { startPosEventsHandler } from './services/pos-events.handler.js'
import { startPaymentsEventsHandler } from './services/payments-events.handler.js'
import { startVerifactuEventsHandler } from './services/verifactu-events.handler.js'

export { runMigrations } from './lib/migrate.js'
export { enforceGrants } from './lib/grants.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)
  if (redis && !app.hasDecorator('_redis')) app.decorate('_redis', redis)

  app.get('/api/tpv/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'tpv', timestamp: new Date().toISOString(),
  }))

  await app.register(devicesRoutes,      { prefix: '/v1/tpv/devices' })
  await app.register(seriesRoutes,       { prefix: '/v1/tpv/series' })
  await app.register(sessionsRoutes,     { prefix: '/v1/tpv/sessions' })
  await app.register(billingFactsRoutes, { prefix: '/v1/tpv/billing-facts' })
  await app.register(receiptsRoutes,     { prefix: '/v1/tpv/receipts' })
  await app.register(creditNotesRoutes,  { prefix: '/v1/tpv/credit-notes' })
  await app.register(reportsRoutes,      { prefix: '/v1/tpv/reports' })
  await app.register(settingsRoutes,     { prefix: '/v1/tpv/settings' })
  await app.register(adminRoutes,        { prefix: '/v1/tpv/admin' })

  if (redis) {
    startPosEventsHandler({ redis })
    startPaymentsEventsHandler({ redis })
    startVerifactuEventsHandler({ redis })
  }

  logger?.info('tpv module ready')
}
