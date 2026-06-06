import { createPool, withTenantTransaction, withTransaction } from '@apphub/platform-sdk/db'
import { env } from './env.js'
import { logger } from './logger.js'

// Pool inyectable (contrato de módulo, ADR 018): el orquestador apps-servers
// inyecta el Pool ligado a svc_app_aulavera vía configurePool(); en modo
// standalone (src/server.js) se crea perezosamente desde DATABASE_URL.
let _pool = null

export function configurePool(injected) {
  if (injected) _pool = injected
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

// Re-export the SDK helpers so route/service code only imports from here.
export { withTenantTransaction, withTransaction }
