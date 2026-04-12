import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { pool } from './lib/db.js'
import { redis } from './lib/redis.js'
import { runMigrations } from './lib/migrate.js'

async function start(): Promise<void> {
  // Run DB migrations before accepting traffic
  await runMigrations()

  const app = createApp()

  const server = app.listen(env.PAYMENTS_PORT, () => {
    logger.info(
      { port: env.PAYMENTS_PORT, env: env.NODE_ENV },
      'split-payments service started',
    )
  })

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received')
    server.close(async () => {
      await pool.end()
      await redis.quit()
      logger.info('Graceful shutdown complete')
      process.exit(0)
    })
    // Force exit after 10 seconds
    setTimeout(() => process.exit(1), 10_000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start service')
  process.exit(1)
})
