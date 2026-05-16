import { publicRoutes, adminRoutes } from './routes/leads.routes.js'
import { configurePool } from './lib/db.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db }) {
  configurePool(db)

  app.get('/api/leads/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'leads', timestamp: new Date().toISOString(),
  }))

  await app.register(publicRoutes, { prefix: '/v1/leads' })
  await app.register(adminRoutes,  { prefix: '/v1/leads/admin' })
}
