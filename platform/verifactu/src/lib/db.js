import { createPool } from '@apphub/platform-sdk/db'
import { env } from './env.js'
import { logger } from './logger.js'

let _pool = null

export function configurePool(injected) {
  _pool = injected
}

function ensurePool() {
  if (_pool) return _pool
  _pool = createPool(env.DATABASE_URL)
  _pool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'))
  return _pool
}

export const pool = new Proxy({}, {
  get(_t, key) {
    const p = ensurePool()
    const value = p[key]
    return typeof value === 'function' ? value.bind(p) : value
  },
})

// Run a transaction with the tenant RLS context set. Same pattern as the
// rest of the platform modules (inquiries, donations, …) — the RLS policy
// reads current_setting('app.tenant_id').
export async function withTenantTransaction(appId, tenantId, subTenantId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.app_id',        $1, true)`, [appId])
    await client.query(`SELECT set_config('app.tenant_id',     $1, true)`, [tenantId])
    await client.query(`SELECT set_config('app.sub_tenant_id', $1, true)`, [subTenantId ?? ''])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
