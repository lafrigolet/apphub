import { createPool, withTransaction } from '@apphub/platform-sdk/db'
import { env } from './env.js'
import { logger } from './logger.js'

let _pool = null
export function configurePool(injected) { _pool = injected }
function ensurePool() {
  if (_pool) return _pool
  _pool = createPool(env.DATABASE_URL)
  _pool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'))
  return _pool
}
export const pool = new Proxy({}, {
  get(_t, key) {
    const p = ensurePool()
    const v = p[key]
    return typeof v === 'function' ? v.bind(p) : v
  },
})
export { withTransaction }
