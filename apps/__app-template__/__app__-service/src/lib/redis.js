import { createRedis, publish as sdkPublish } from '@apphub/platform-sdk/redis'
import { env } from './env.js'
import { logger } from './logger.js'
export const redis = createRedis(env.REDIS_URL)
redis.on('connect', () => logger.info('Redis connected'))
redis.on('error', (err) => logger.error({ err }, 'Redis error'))
// STEP: replace '__app__' with your app_id
export async function publish(event) { return sdkPublish(redis, '__app__', event) }
