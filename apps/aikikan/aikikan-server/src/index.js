// Contrato de módulo (ADR 018): aikikan-server se hospeda en el orquestador
// `apps-servers` junto al resto de app-servers. El guard de app_id va POR
// SCOPE (makeAppGuardHook('aikikan')) — en un proceso compartido el appGuard
// global del SDK no sirve: solo valida un EXPECTED_APP_ID por proceso y un
// token de otro app podría tocar estas rutas (regla 2 de CLAUDE.md).
//
// El modo standalone (src/server.js + Dockerfile) sigue funcionando como
// artefacto ready-to-split, igual que platform/tpv (ADR 016).
import { makeAppGuardHook, ensureIdentityDecorator } from '@apphub/platform-sdk/app-guard'
import { configurePool } from './lib/db.js'
import { membersRoutes }      from './routes/members.routes.js'
import { videosRoutes }       from './routes/videos.routes.js'
import { dojosRoutes }        from './routes/dojos.routes.js'
import { feesRoutes }         from './routes/fees.routes.js'
import { certificatesRoutes } from './routes/certificates.routes.js'
import { startUserRevokedSubscriber } from './events/user-revoked.handler.js'
import { startSplitpayEventSubscriber } from './events/splitpay.handler.js'

export const APP_ID = 'aikikan'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger, subscribe = true }) {
  configurePool(db)
  await ensureIdentityDecorator(app)

  // Health del módulo — público, sin guard.
  app.get('/v1/aikikan/health', { config: { public: true } }, async () => ({
    status: 'ok', service: 'aikikan-server', timestamp: new Date().toISOString(),
  }))

  // Scope encapsulado: el guard SOLO aplica a las rutas de este app.
  await app.register(async (scope) => {
    scope.addHook('preHandler', makeAppGuardHook(APP_ID))
    await scope.register(membersRoutes)
    await scope.register(videosRoutes)
    await scope.register(dojosRoutes)
    await scope.register(feesRoutes)
    await scope.register(certificatesRoutes)
  })

  // Suscriptores Redis del app (canal platform:events + aikikan.events).
  // Crean su propia conexión (pub/sub no multiplexa) leyendo REDIS_URL.
  // subscribe=false en tests de integración (no necesitan los consumers).
  if (subscribe) {
    const subs = [startUserRevokedSubscriber(), startSplitpayEventSubscriber()]
    app.addHook('onClose', async () => {
      for (const sub of subs) await sub.quit().catch(() => {})
    })
  }

  logger?.info('aikikan module ready')
}
