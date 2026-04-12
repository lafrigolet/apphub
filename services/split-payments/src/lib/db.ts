import pg from 'pg'
import { env } from './env.js'
import { logger } from './logger.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error')
})

/**
 * Execute a query scoped to the current tenant.
 * Sets session-level GUCs used by Row Level Security policies.
 */
export async function withTenant<T>(
  tenantId: string,
  subTenantId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`)
    if (subTenantId) {
      await client.query(`SET LOCAL app.sub_tenant_id = '${subTenantId}'`)
    }
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
