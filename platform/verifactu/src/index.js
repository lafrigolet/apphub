import { publicRoutes } from './routes/verifactu.routes.js'
import { configurePool } from './lib/db.js'
import { startTpvEventsHandler } from './services/tpv-events.handler.js'
import { startRemisionEventsHandler } from './services/remision-events.handler.js'
import { startDomainEventsHandler } from './services/domain-events.handler.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)

  app.get('/api/verifactu/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'verifactu', timestamp: new Date().toISOString(),
  }))

  // Portal-facing endpoints. Públicos por ahora (sin login): el scope
  // (appId, tenantId) viaja en query/body. Cuando se cablee el login,
  // estos pasarán a leer req.identity y añadiremos admin endpoints
  // role-gated para las mutaciones sensibles.
  await app.register(async (scope) => {
    await publicRoutes(scope)
  }, { prefix: '/v1/verifactu' })

  // Registro fiscal de los recibos/abonos de platform/tpv (ADR 015):
  // tpv.receipt.issued → alta encadenada; tpv.receipt.voided → rectificativa.
  // Y el drenado de la cola de remisión disparado por el scheduler.
  if (redis) {
    startTpvEventsHandler({ redis })
    startRemisionEventsHandler({ redis })
    startDomainEventsHandler({ redis }) // order.completed / donation.created → alta (§15)
  }
}
