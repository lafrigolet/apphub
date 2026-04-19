import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { redis } from './lib/redis.js'

async function start() {
  const app = createApp()
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'platform-basket service started')
  } catch (err) { logger.error({ err }, 'Failed to start'); process.exit(1) }
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    await app.close(); await redis.quit(); process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
start().catch((err) => { console.error(err); process.exit(1) })
