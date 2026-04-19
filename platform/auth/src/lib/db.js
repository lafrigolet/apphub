import { createPool, setTenantContext, withTenantTransaction, withTransaction } from '@apphub/platform-sdk/db'
import { env } from './env.js'
import { logger } from './logger.js'

export const pool = createPool(env.DATABASE_URL)
pool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'))

export { setTenantContext, withTenantTransaction, withTransaction }
