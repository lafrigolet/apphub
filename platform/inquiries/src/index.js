import { publicRoutes, adminRoutes } from './routes/inquiries.routes.js'
import { configurePool } from './lib/db.js'
import { startEventConsumer } from './services/event-consumer.js'
import { logger } from './lib/logger.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)

  // Inbound email bridge (notifications §26): user email replies re-ingested
  // into the inquiry timeline via `inquiry.reply.received`.
  const consumer = startEventConsumer({ redis, logger })
  if (consumer) {
    app.addHook('onClose', async () => { try { consumer.disconnect() } catch { /* shutting down */ } })
  }

  app.get('/api/inquiries/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'inquiries', timestamp: new Date().toISOString(),
  }))

  // POST público — el form de cualquier app llama aquí sin JWT. RLS se
  // setea con el (appId, tenantId) del body.
  await app.register(async (publicScope) => {
    await publicRoutes(publicScope, { redis })
  }, { prefix: '/v1/inquiries' })

  // Admin endpoints — requiere role owner/admin/staff/super_admin.
  await app.register(async (adminScope) => {
    await adminRoutes(adminScope, { redis })
  }, { prefix: '/v1/inquiries/admin' })
}
