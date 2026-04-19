import Redis from 'ioredis'

/**
 * Creates a Redis client. Consuming services call this with their own REDIS_URL.
 */
export function createRedis(redisUrl) {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  })
  return redis
}

/**
 * Publishes an event to a namespaced channel.
 * Channel pattern: {appId}.events
 */
export async function publish(redis, appId, event) {
  const channel = `${appId}.events`
  await redis.publish(channel, JSON.stringify(event))
}

/**
 * Subscribes to a namespaced channel.
 * Returns the subscriber client.
 */
export function subscribe(redisUrl, appId, onMessage) {
  const sub = new Redis(redisUrl)
  const channel = `${appId}.events`
  sub.subscribe(channel, (err) => {
    if (err) console.error({ err, channel }, 'Redis subscribe error')
  })
  sub.on('message', onMessage)
  return sub
}
