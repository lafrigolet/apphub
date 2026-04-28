import pg from 'pg'
import { env } from './env.js'
import { logger } from './logger.js'

const { Pool } = pg

let _pool = null

export function configurePool(injected) {
  _pool = injected
}

function ensurePool() {
  if (_pool) return _pool
  _pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  _pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'))
  return _pool
}

export const pool = new Proxy({}, {
  get(_t, key) {
    const p = ensurePool()
    const value = p[key]
    return typeof value === 'function' ? value.bind(p) : value
  },
})

/**
 * Execute a query scoped to the current tenant.
 * Sets session-level GUCs used by Row Level Security policies.
 */
export async function withTenant(tenantId, subTenantId, fn) {
  const client = await ensurePool().connect()
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
