import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { pool } from './lib/db.js'
import { redis } from './lib/redis.js'
import { runMigrations } from './lib/migrate.js'

async function start() {
  await runMigrations()
  const app = createApp()

  try {
    await app.listen({ port: env.YOGA_CLASSES_PORT, host: '0.0.0.0' })
    logger.info({ port: env.YOGA_CLASSES_PORT, env: env.NODE_ENV }, 'yoga-classes service started')
  } catch (err) {
    logger.error({ err }, 'Failed to start Fastify')
    process.exit(1)
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received')
    try {
      await app.close()
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
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start service')
  process.exit(1)
})
