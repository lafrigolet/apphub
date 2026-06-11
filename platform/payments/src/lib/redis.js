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

// ── Idempotency (Redis, 24h TTL) ─────────────────────────────────────────────
// Critical project rule (CLAUDE.md §3): every Stripe call is deduplicated by an
// idempotency key. We cache the *result* of the operation so a retried request
// returns the same transaction instead of creating a second charge.
const IDEMPOTENCY_TTL = 60 * 60 * 24 // 24 hours

export async function checkIdempotency(key) {
  return ensureRedis().get(`payments:idem:${key}`)
}

export async function storeIdempotency(key, result) {
  await ensureRedis().setex(`payments:idem:${key}`, IDEMPOTENCY_TTL, JSON.stringify(result))
}

// ── Pay-link shortener (Redis, TTL = session expiry) ─────────────────────────
// Maps a short opaque code → the full hosted checkout URL so the QR can encode a
// short, branded link (https://host/v1/payments/pay/<code>) instead of the long
// Stripe URL. The public redirect endpoint resolves the code back to the URL.
const PAYLINK_PREFIX = 'payments:paylink:'

export async function storePayLink(code, url, ttlSeconds) {
  await ensureRedis().setex(`${PAYLINK_PREFIX}${code}`, ttlSeconds, url)
}

export async function getPayLink(code) {
  return ensureRedis().get(`${PAYLINK_PREFIX}${code}`)
}
