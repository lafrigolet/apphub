// Per-user notification rate limiting backed by Redis counters.
//
// Two windows: rolling-hour and rolling-day. Both are configurable via
// notifications.config (rate_limit_per_user_per_hour /
// rate_limit_per_user_per_day). Empty / 0 / negative means unlimited for
// that window.
//
// Caller pattern (in send wrappers):
//   const verdict = await checkRateLimit({ userId, eventClass, channel })
//   if (verdict.allowed) await actuallySend(...)
//
// We use a separate Redis namespace ("nrl:") so it doesn't collide with
// other Redis structures the platform uses.

import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'

const CACHE_TTL_MS = 30_000
let cache = { hour: null, day: null, expiresAt: 0 }

async function loadLimits() {
  if (Date.now() < cache.expiresAt) return cache
  const client = await pool.connect()
  try {
    const hour = await configRepo.getValue(client, 'rate_limit_per_user_per_hour')
    const day  = await configRepo.getValue(client, 'rate_limit_per_user_per_day')
    cache = {
      hour: parseLimit(hour),
      day:  parseLimit(day),
      expiresAt: Date.now() + CACHE_TTL_MS,
    }
  } finally { client.release() }
  return cache
}

function parseLimit(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function invalidateRateLimitCache() { cache.expiresAt = 0 }

function hourBucket(now = new Date()) {
  // YYYY-MM-DDTHH — UTC, hourly bucket. Avoids timezone issues entirely; the
  // user's perceived "day" is approximate but rate-limit intent is platform
  // protection, not user fairness.
  return now.toISOString().slice(0, 13)
}

function dayBucket(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

// Returns { allowed: bool, reason?: string, limits: { hour, day }, current: { hour, day } }.
// Atomically increments the counters when allowed == true, so callers don't
// need to retry on race. When a limit is null the counter is incremented but
// not checked (so we always have observability data).
export async function checkRateLimit({ userId, eventClass, channel }) {
  if (!userId) return { allowed: true, reason: 'no-user' }
  const key = `${userId}:${eventClass}:${channel}`
  const limits = await loadLimits()

  const hourKey = `nrl:h:${key}:${hourBucket()}`
  const dayKey  = `nrl:d:${key}:${dayBucket()}`

  const pipe = redis.multi()
  pipe.incr(hourKey).expire(hourKey, 3600 + 60)
  pipe.incr(dayKey).expire(dayKey,  86_400 + 600)
  const results = await pipe.exec()
  // ioredis returns [[err, val], ...] — incr is at indexes 0 and 2.
  const hourCount = Number(results?.[0]?.[1] ?? 0)
  const dayCount  = Number(results?.[2]?.[1] ?? 0)

  const exceededHour = limits.hour != null && hourCount > limits.hour
  const exceededDay  = limits.day  != null && dayCount  > limits.day
  if (exceededHour || exceededDay) {
    const reason = exceededHour ? 'hour' : 'day'
    logger.warn({ userId, eventClass, channel, hourCount, dayCount, limits, reason }, 'rate-limit hit')
    // Roll back the increment that put us over the limit so a single hot
    // burst doesn't keep extending the suppression for the rest of the
    // window. Best-effort — if the decr fails we still drop this message.
    if (exceededHour) await redis.decr(hourKey).catch(() => {})
    if (exceededDay)  await redis.decr(dayKey).catch(() => {})
    return {
      allowed: false,
      reason,
      limits,
      current: { hour: hourCount - (exceededHour ? 1 : 0), day: dayCount - (exceededDay ? 1 : 0) },
    }
  }
  return { allowed: true, limits, current: { hour: hourCount, day: dayCount } }
}
