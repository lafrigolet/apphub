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

const IDEMPOTENCY_TTL = 60 * 60 * 24 // 24 hours in seconds

/**
 * Check if an idempotency key has already been processed.
 * Returns the cached response if it exists, null otherwise.
 */
export async function checkIdempotency(key) {
  return redis.get(`idempotency:${key}`)
}

/**
 * Store the result of an idempotent operation.
 */
export async function storeIdempotency(key, result) {
  await redis.setex(`idempotency:${key}`, IDEMPOTENCY_TTL, JSON.stringify(result))
}

/**
 * Cache a value with a TTL in seconds.
 */
export async function cacheSet(key, value, ttlSeconds) {
  await redis.setex(`cache:${key}`, ttlSeconds, JSON.stringify(value))
}

/**
 * Get a cached value. Returns null if not found or expired.
 */
export async function cacheGet(key) {
  const raw = await redis.get(`cache:${key}`)
  return raw ? JSON.parse(raw) : null
}

/**
 * Invalidate a cache entry.
 */
export async function cacheDelete(key) {
  await redis.del(`cache:${key}`)
}
