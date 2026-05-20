import { publicRoutes, authenticatedRoutes, adminRoutes } from './routes/donations.routes.js'
import { publicCausesRoutes, adminCausesRoutes }           from './routes/causes.routes.js'
import { adminFiscalRoutes }                                from './routes/fiscal.routes.js'
import { configurePool } from './lib/db.js'
import { startSplitpayEventsHandler } from './services/splitpay-events.handler.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)

  // Healthcheck público para liveness.
  app.get('/api/donations/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'donations', timestamp: new Date().toISOString(),
  }))

  // Causas — públicas (lectura) + admin (CRUD).
  await app.register(publicCausesRoutes, { prefix: '/v1/donations/causes' })
  await app.register(adminCausesRoutes,  { prefix: '/v1/donations/causes/admin' })

  // Donaciones — checkout público, lectura autenticada (me), admin (gestión).
  await app.register(publicRoutes,        { prefix: '/v1/donations' })
  await app.register(authenticatedRoutes, { prefix: '/v1/donations' })
  await app.register(adminRoutes,         { prefix: '/v1/donations/admin' })

  // Fiscal — admin only (certificados + modelo 182).
  await app.register(adminFiscalRoutes,   { prefix: '/v1/donations/fiscal' })

  // Subscriber a eventos de splitpay. Sólo procesa eventos con
  // metadata.purpose === 'donation' — el resto los ignora. Usa una
  // conexión Redis propia (pub/sub no multiplexa con regular).
  startSplitpayEventsHandler({ redis })
}
