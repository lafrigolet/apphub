import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/payments/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'payments', timestamp: new Date().toISOString(),
  }))

  // Routes will be wired here as the payments module is built out (Stripe gateway,
  // webhooks, transfers, etc.). For now this is a skeleton — same as before the
  // migration to platform-core, just running inside the orchestrator process.
}
