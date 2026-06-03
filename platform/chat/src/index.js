import { memberRoutes } from './routes/conversations.routes.js'
import { supportRoutes } from './routes/support.routes.js'
import { moderationRoutes } from './routes/moderation.routes.js'
import { adminRoutes } from './routes/admin.routes.js'
import { createGateway } from './ws/gateway.js'
import { startEventConsumer } from './services/event-consumer.js'
import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/chat/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'chat', timestamp: new Date().toISOString(),
  }))

  // Real-time gateway — registers GET /v1/chat/ws and subscribes to the
  // cross-instance Redis fan-out channel.
  const gateway = createGateway({ redis, logger })
  app.addHook('onClose', () => gateway.close())

  // Consumer for scheduler-driven events (chat.scheduled.due → deliver).
  const consumer = startEventConsumer({ redis, logger })
  app.addHook('onClose', () => consumer?.quit?.())

  // All authenticated member + support + moderation routes share the /v1/chat
  // prefix. appGuard (registered once on the root app) populates req.identity.
  await app.register(async (scope) => {
    await memberRoutes(scope)
    await supportRoutes(scope)
    await moderationRoutes(scope)
    gateway.registerRoutes(scope)
  }, { prefix: '/v1/chat' })

  // Staff-only admin surface (settings + reports).
  await app.register(adminRoutes, { prefix: '/v1/chat/admin' })
}
