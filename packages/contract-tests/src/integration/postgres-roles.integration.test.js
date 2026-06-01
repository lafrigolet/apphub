// postgres-init runtime contract (sección 6 · P0) — verifica EN RUNTIME que,
// tras aplicar infra/postgres/init/*, existen de verdad todos los schemas y
// roles dedicados por módulo. Conexión por defecto a localhost:5432 (donde
// docker-compose publica postgres); override por PLATFORM_PG_HOST/PORT/DB.
// Skip si la DB no es accesible.
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'

const DB = {
  host: process.env.PLATFORM_PG_HOST ?? 'localhost',
  port: Number(process.env.PLATFORM_PG_PORT ?? 5432),
  database: process.env.PLATFORM_PG_DB ?? 'splitpay',
  user: process.env.PLATFORM_PG_USER ?? 'splitpay',
  password: process.env.PLATFORM_PG_PASSWORD ?? 'splitpay',
}

const MODULES = [
  'auth', 'payments', 'notifications', 'catalog', 'tenants',
  'orders', 'inventory', 'reviews', 'messaging', 'shipping', 'disputes',
  'menu', 'reservations', 'floor_plan', 'kds', 'pos', 'delivery_dispatch',
  'services', 'resources', 'bookings', 'availability', 'intake_forms',
  'telehealth', 'packages', 'practitioner_payouts',
  'scheduler', 'storage', 'leads', 'donations', 'inquiries', 'verifactu',
]

let client = null
try {
  client = new pg.Client(DB)
  await client.connect()
} catch {
  client = null
}
const maybe = client ? it : it.skip
if (!client) {
  // eslint-disable-next-line no-console
  console.warn(`[postgres-roles] postgres no accesible en ${DB.host}:${DB.port} — tests SKIPeados`)
}
afterAll(async () => { if (client) await client.end().catch(() => {}) })

describe('postgres init — schemas y roles en runtime', () => {
  maybe('existen todos los schemas platform_<modulo>', async () => {
    const { rows } = await client.query(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'platform\\_%'`,
    )
    const present = new Set(rows.map((r) => r.nspname))
    const missing = MODULES.map((m) => `platform_${m}`).filter((s) => !present.has(s))
    expect(missing, `schemas ausentes: ${missing.join(', ')}`).toEqual([])
  })

  maybe('existen los roles dedicados svc_platform_<modulo> (≥ 30)', async () => {
    const { rows } = await client.query(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'svc\\_platform\\_%'`,
    )
    const present = new Set(rows.map((r) => r.rolname))
    expect(present.size).toBeGreaterThanOrEqual(30)
    for (const r of ['svc_platform_auth', 'svc_platform_leads', 'svc_platform_verifactu', 'svc_platform_inquiries']) {
      expect(present.has(r), `falta rol ${r}`).toBe(true)
    }
  })

  maybe('los schemas de app (aikikan, aulavera) existen', async () => {
    const { rows } = await client.query(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('app_aikikan','app_aulavera')`,
    )
    expect(rows.map((r) => r.nspname).sort()).toEqual(['app_aikikan', 'app_aulavera'])
  })
})
