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

// Helper para correr una transacción con el contexto RLS del tenant ya
// seteado. Patrón usado por el resto de módulos plataforma.
export async function withTenantTransaction(appId, tenantId, subTenantId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.app_id',       $1, true)`, [appId])
    await client.query(`SELECT set_config('app.tenant_id',    $1, true)`, [tenantId])
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

// Para lecturas/inserts que vienen de webhooks de Stripe — no hay
// tenant context en el request, pero los rows ya tienen sus
// (app_id, tenant_id) en columnas. Usamos staff bypass.
export async function withStaffBypass(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.app_id',       '__internal__',                         true)`)
    await client.query(`SELECT set_config('app.tenant_id',    '00000000-0000-0000-0000-000000000000', true)`)
    await client.query(`SELECT set_config('app.staff_access', 'true',                                 true)`)
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
