import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

let _redis = null

export function configureRedis(injected) {
  _redis = injected
}

function ensureRedis() {
  if (_redis) return _redis
  _redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  })
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

const IDEMPOTENCY_TTL = 60 * 60 * 24 // 24 hours

export async function checkIdempotency(key) {
  return ensureRedis().get(`idempotency:${key}`)
}

export async function storeIdempotency(key, result) {
  await ensureRedis().setex(`idempotency:${key}`, IDEMPOTENCY_TTL, JSON.stringify(result))
}

export async function cacheSet(key, value, ttlSeconds) {
  await ensureRedis().setex(`cache:${key}`, ttlSeconds, JSON.stringify(value))
}

export async function cacheGet(key) {
  const raw = await ensureRedis().get(`cache:${key}`)
  return raw ? JSON.parse(raw) : null
}

export async function cacheDelete(key) {
  await ensureRedis().del(`cache:${key}`)
}
