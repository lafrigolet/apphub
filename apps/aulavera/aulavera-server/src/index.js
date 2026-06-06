// Contrato de módulo (ADR 018): aulavera-server se hospeda en el orquestador
// `apps-servers`. Guard de app_id POR SCOPE (makeAppGuardHook('aulavera')) —
// ver el razonamiento en apps/aikikan/aikikan-server/src/index.js.
import { makeAppGuardHook, ensureIdentityDecorator } from '@apphub/platform-sdk/app-guard'
import { configurePool } from './lib/db.js'
import { eventsRoutes }      from './routes/events.routes.js'
import { disciplinesRoutes } from './routes/disciplines.routes.js'
import { resourcesRoutes }   from './routes/resources.routes.js'

export const APP_ID = 'aulavera'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  await ensureIdentityDecorator(app)

  // Health del módulo — público, sin guard.
  app.get('/v1/aulavera/health', { config: { public: true } }, async () => ({
    status: 'ok', service: 'aulavera-server', timestamp: new Date().toISOString(),
  }))

  // Scope encapsulado: el guard SOLO aplica a las rutas de este app.
  await app.register(async (scope) => {
    scope.addHook('preHandler', makeAppGuardHook(APP_ID))
    await scope.register(eventsRoutes)
    await scope.register(disciplinesRoutes)
    await scope.register(resourcesRoutes)
  })

  logger?.info('aulavera module ready')
}
