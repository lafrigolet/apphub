import { configurePool } from './lib/db.js'
import { configureRedis, subscribe } from './lib/redis.js'
import { availabilityRoutes } from './routes/availability.routes.js'
import * as service from './services/availability.service.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis, logger }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/availability/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'availability', timestamp: new Date().toISOString(),
  }))

  await app.register(availabilityRoutes)

  // Event-driven cache invalidation (recommendation #3). When a resource
  // exception is created, platform/resources publishes `resource.unavailable`;
  // the cached slot grid for that resource is now stale, so we bump its
  // version key (the next slot read recomputes from scratch). Without this
  // the grid could serve a slot that an exception just blocked, up to the
  // 60s cache TTL.
  app.addHook('onReady', async () => {
    subscribe(async (_channel, raw) => {
      let event
      try { event = JSON.parse(raw) } catch { return }
      if (event.type !== 'resource.unavailable') return
      const { appId, tenantId, resourceId } = event.payload ?? {}
      await service.invalidateResourceCache(appId, tenantId, resourceId)
    })
    logger?.info('availability subscribed to resource.unavailable for cache invalidation')
  })

  logger?.info('availability module ready')
}
