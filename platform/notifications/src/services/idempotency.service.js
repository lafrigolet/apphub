// Consumer-side idempotency for platform.events.
//
// Redis Pub/Sub gives at-most-once *per connection*, but the broader system can
// redeliver the same logical event (producer retry, reconnect replay, a manual
// re-publish from an admin tool). Without a guard the consumer would re-send
// the same email/SMS/push twice.
//
// We dedup with an atomic Redis `SET key NX EX ttl`: the first delivery wins
// the key and proceeds; any subsequent delivery within the TTL window is a
// no-op. The key is derived from an explicit `idempotencyKey`/`id` on the event
// when the producer provides one, otherwise from a stable hash of the event
// (type + payload). TTL defaults to 24h — long enough to cover realistic
// redelivery windows, short enough to bound Redis memory.
//
// Best-effort by design: if Redis is unavailable the guard "fails open"
// (returns true / allows the send) so a Redis blip never silences
// notifications. Double-send under a Redis outage is the safer failure mode
// than no-send.

import crypto from 'node:crypto'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'

const NS = 'ndedup:'
const DEFAULT_TTL_SECONDS = 24 * 60 * 60

// Stable key for an event. Prefers an explicit idempotency key from the
// producer; falls back to a sha256 of the canonical (type + sorted payload).
export function eventKey(event) {
  const explicit = event?.idempotencyKey ?? event?.idempotency_key ?? event?.id
  if (explicit) return `${event.type}:${explicit}`
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ t: event?.type, p: event?.payload ?? null }))
    .digest('hex')
  return `${event?.type}:${hash}`
}

// Returns true when this is the first time we see the event (caller should
// process it), false when it's a duplicate (caller should skip). Fails open on
// any Redis error.
export async function claimEvent(event, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const key = `${NS}${eventKey(event)}`
  try {
    // SET key 1 NX EX ttl → 'OK' on first set, null when the key already
    // exists. ioredis arg order: SET key value EX ttl NX.
    const res = await redis.set(key, '1', 'EX', ttlSeconds, 'NX')
    if (res === null) {
      logger.info({ type: event?.type, key }, 'duplicate event suppressed (idempotency)')
      return false
    }
    return true
  } catch (err) {
    // Fail open — never let a Redis hiccup swallow a notification.
    logger.warn({ err, type: event?.type }, 'idempotency claim failed — proceeding (fail-open)')
    return true
  }
}
