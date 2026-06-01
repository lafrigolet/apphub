import { publicRoutes, adminRoutes } from './routes/leads.routes.js'
import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/leads/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'leads', timestamp: new Date().toISOString(),
  }))

  await app.register(publicRoutes, { prefix: '/v1/leads' })
  await app.register(adminRoutes,  { prefix: '/v1/leads/admin' })
}
