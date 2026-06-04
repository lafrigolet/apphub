import { publish as redisPublish } from './redis.js'
import { logger } from './logger.js'

// Domain events for the catalog module, published on the shared
// `platform.events` channel (via lib/redis.publish → sdkPublish('platform')).
// Consumers: search indexers, basket/wishlist cleanup, cache-busting, RSS.
//
// Publishing is best-effort: a Redis hiccup must never fail the write that
// already committed. We log and swallow, mirroring platform/orders.
export async function emitCatalogEvent(type, payload) {
  try {
    await redisPublish({ type, payload })
  } catch (err) {
    logger.warn({ err, type }, 'failed to publish catalog event')
  }
}
