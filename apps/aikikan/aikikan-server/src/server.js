import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { pool } from './lib/db.js'
import { redis } from './lib/redis.js'
import { runMigrations } from './lib/migrate.js'
import { startUserRevokedSubscriber } from './events/user-revoked.handler.js'
import { startSplitpayEventSubscriber } from './events/splitpay.handler.js'

async function start() {
  await runMigrations()
  const app = createApp()
  const subscriber = startUserRevokedSubscriber()
  const splitpaySub = startSplitpayEventSubscriber()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'aikikan-server started')
  } catch (err) {
    logger.error({ err }, 'Failed to start')
    process.exit(1)
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    try {
      await app.close()
      await subscriber.quit().catch(() => {})
      await splitpaySub.quit().catch(() => {})
      await pool.end()
      await redis.quit()
      logger.info('Graceful shutdown complete')
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Error during shutdown')
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

start().catch((err) => {
  logger.error({ err }, 'Startup failure')
  process.exit(1)
})
