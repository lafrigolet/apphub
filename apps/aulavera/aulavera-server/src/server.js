// Modo STANDALONE — artefacto ready-to-split (ADR 018). En producción el
// módulo corre dentro del orquestador apps-servers; este boot existe para
// poder re-extraer aulavera-server a su propio contenedor sin tocar lógica.
import { createApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { pool } from './lib/db.js'
import { redis } from './lib/redis.js'
import { runMigrations } from './lib/migrate.js'

async function start() {
  await runMigrations()
  const app = await createApp()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'aulavera-server started (standalone)')
  } catch (err) {
    logger.error({ err }, 'Failed to start')
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
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

start().catch((err) => {
  logger.error({ err }, 'Startup failure')
  process.exit(1)
})
