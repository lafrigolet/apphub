import { publicRoutes, adminRoutes } from './routes/inquiries.routes.js'
import { configurePool } from './lib/db.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)

  app.get('/api/inquiries/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'inquiries', timestamp: new Date().toISOString(),
  }))

  // POST público — el form de cualquier app llama aquí sin JWT. RLS se
  // setea con el (appId, tenantId) del body.
  await app.register(async (publicScope) => {
    await publicRoutes(publicScope, { redis })
  }, { prefix: '/v1/inquiries' })

  // Admin endpoints — requiere role owner/admin/staff/super_admin.
  await app.register(adminRoutes, { prefix: '/v1/inquiries/admin' })
}
