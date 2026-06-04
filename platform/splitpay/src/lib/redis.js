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

// Tenant-namespaced idempotency (priority #8). The plain helpers above key on
// the raw caller string, so two different apps/tenants reusing the same
// idempotency key would collide (one would receive the other's cached result).
// These scope the Redis key by tenant so a key is only ever shared within the
// same tenant. Same 24h TTL (regla CLAUDE.md #3).
function scopedKey(tenantId, key) {
  return `idempotency:${tenantId ?? 'no-tenant'}:${key}`
}

export async function checkIdempotencyScoped(tenantId, key) {
  return ensureRedis().get(scopedKey(tenantId, key))
}

export async function storeIdempotencyScoped(tenantId, key, result) {
  await ensureRedis().setex(scopedKey(tenantId, key), IDEMPOTENCY_TTL, JSON.stringify(result))
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
