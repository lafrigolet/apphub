import { AppError } from '@apphub/platform-sdk/errors'
import { getRedis } from './redis.js'

// Lightweight per-key sliding-window-ish limiter backed by Redis INCR + EXPIRE.
// No-op when redis isn't configured (unit tests). Throws a 429 AppError when
// the count exceeds `max` within `windowSec`.
export async function enforceRate(key, max, windowSec) {
  const redis = getRedis()
  if (!redis) return
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, windowSec)
  if (n > max) throw new AppError('RATE_LIMITED', 'Too many messages, slow down', 429)
}
