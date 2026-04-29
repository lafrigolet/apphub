import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { messagingRoutes } from './routes/messaging.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/messages/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'messaging', timestamp: new Date().toISOString(),
  }))

  await app.register(messagingRoutes)
}
