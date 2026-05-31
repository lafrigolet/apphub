import { publicRoutes } from './routes/verifactu.routes.js'
import { configurePool } from './lib/db.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db }) {
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
}
