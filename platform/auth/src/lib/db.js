import { createPool, setTenantContext, withTenantTransaction, withTransaction } from '@apphub/platform-sdk/db'
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

// Forward all property accesses to the underlying pg.Pool. Tests that mock this
// module replace the export entirely, so the Proxy is bypassed in unit tests.
// In integration tests (no mock) ensurePool() lazily creates the pool from env.
// In platform-core, configurePool() injects the orchestrator-owned pool before
// any service runs.
export const pool = new Proxy({}, {
  get(_t, key) {
    const p = ensurePool()
    const value = p[key]
    return typeof value === 'function' ? value.bind(p) : value
  },
})

export { setTenantContext, withTenantTransaction, withTransaction }
