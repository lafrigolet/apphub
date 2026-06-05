import { publish } from '@apphub/platform-sdk/redis'
import { logger } from './logger.js'

let _redis = null

export function configureRedis(injected) {
  _redis = injected
}

export function getRedis() {
  return _redis
}

// Todos los eventos del módulo salen por el canal 'platform.events'
// (mismo criterio que platform/pos). Fire-and-forget: un fallo de
// publicación no debe romper la operación de caja.
export async function publishEvent(type, payload) {
  if (!_redis) return
  try {
    await publish(_redis, 'platform', { type, payload })
  } catch (err) {
    logger.error({ err, type }, 'Failed to publish event')
  }
}
