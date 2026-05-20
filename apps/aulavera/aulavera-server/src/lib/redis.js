import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
})

redis.on('error', (err) => logger.error({ err }, 'Redis error'))
redis.on('connect', () => logger.info('Redis connected'))
