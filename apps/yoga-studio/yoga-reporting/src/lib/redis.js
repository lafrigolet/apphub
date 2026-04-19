import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
})

redis.on('connect', () => logger.info('Redis connected'))
redis.on('error', (err) => logger.error({ err }, 'Redis error'))

export async function cacheSet(key, value, ttlSeconds) {
  await redis.setex(`yoga:cache:${key}`, ttlSeconds, JSON.stringify(value))
}

export async function cacheGet(key) {
  const raw = await redis.get(`yoga:cache:${key}`)
  return raw ? JSON.parse(raw) : null
}

export async function cacheDelete(key) {
  await redis.del(`yoga:cache:${key}`)
}

export async function publish(event) {
  await redis.publish('yoga:events', JSON.stringify(event))
}
