// Hourly — scan basket Redis keys (pattern basket:<app>:<tenant>:<user>),
// find ones idle for ≥24h with at least 1 item, and publish basket.abandoned.
// We use Redis OBJECT IDLETIME so we don't have to modify the basket schema
// to track last activity. To avoid spamming the same user every hour, we
// keep a marker key `basket:abandoned-emitted:<sha>` that expires after 7d.

import crypto from 'node:crypto'

export const meta = {
  name:        'basket-abandoned',
  cron:        '0 * * * *',
  description: 'Detect baskets idle ≥24h and publish basket.abandoned',
}

const IDLE_THRESHOLD_SECONDS = 24 * 60 * 60
const SUPPRESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export async function run({ redis, publish, logger }) {
  let cursor = '0'
  let total = 0
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'basket:*', 'COUNT', 200)
    cursor = next
    for (const key of batch) {
      // Skip our own marker keys.
      if (key.startsWith('basket:abandoned-emitted:')) continue
      const parts = key.split(':')                                   // basket : appId : tenantId : userId
      if (parts.length !== 4) continue
      const [, appId, tenantId, userId] = parts

      const idle = await redis.object('IDLETIME', key)
      if (idle == null || idle < IDLE_THRESHOLD_SECONDS) continue

      const raw = await redis.get(key)
      let basket
      try { basket = JSON.parse(raw) } catch { continue }
      const itemCount = Array.isArray(basket?.items) ? basket.items.length : 0
      if (itemCount === 0) continue

      const sha = crypto.createHash('sha1').update(key).digest('hex')
      const markerKey = `basket:abandoned-emitted:${sha}`
      const alreadyEmitted = await redis.set(markerKey, '1', 'EX', SUPPRESSION_TTL_SECONDS, 'NX')
      if (alreadyEmitted !== 'OK') continue        // we've already emitted recently

      await publish({
        type: 'basket.abandoned',
        payload: {
          appId, tenantId, userId,
          itemCount,
          idleSeconds: idle,
          basketKey:   key,
        },
      })
      total++
    }
  } while (cursor !== '0')
  if (total) logger.info({ count: total }, 'abandoned-cart events published')
  return { rowsAffected: total }
}
