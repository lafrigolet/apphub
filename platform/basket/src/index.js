import { configureRedis } from './lib/redis.js'
import { basketRoutes } from './routes/basket.routes.js'

// Basket has no Postgres schema — state lives entirely in Redis. The orchestrator
// still calls runMigrations() for every module it loads; for basket it's a no-op.
export async function runMigrations() {
  // intentional no-op
}

export async function register({ app, redis }) {
  configureRedis(redis)

  app.get('/api/basket/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'basket', timestamp: new Date().toISOString(),
  }))

  await app.register(basketRoutes)
}
