import { createRedis, publish as sdkPublish } from '@apphub/platform-sdk/redis'
import { env } from './env.js'
import { logger } from './logger.js'

let _redis = null

export function configureRedis(injected) {
  _redis = injected
}

function ensureRedis() {
  if (_redis) return _redis
  _redis = createRedis(env.REDIS_URL)
  _redis.on('connect', () => logger.info('Redis connected'))
  _redis.on('error', (err) => logger.error({ err }, 'Redis error'))
  return _redis
}

export const redis = new Proxy({}, {
  get(_t, key) {
    const r = ensureRedis()
    const value = r[key]
    return typeof value === 'function' ? value.bind(r) : value
  },
})

export async function publish(event) {
  return sdkPublish(ensureRedis(), 'platform', event)
}
