import { authRoutes, internalRoutes } from './routes/auth.routes.js'
import { oauthRoutes } from './routes/oauth.routes.js'
import { usersRoutes } from './routes/users.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/auth/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'auth', timestamp: new Date().toISOString(),
  }))

  await app.register(authRoutes,     { prefix: '/v1/auth' })
  await app.register(oauthRoutes,    { prefix: '/v1/auth/oauth' })
  await app.register(adminRoutes,    { prefix: '/v1/auth/admin' })
  await app.register(usersRoutes)
  await app.register(internalRoutes, { prefix: '/internal' })
}
