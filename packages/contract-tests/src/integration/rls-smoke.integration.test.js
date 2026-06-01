// RLS smoke (sección 5 · P0) — verifica que las tablas tenant-scoped de cada
// módulo tienen Row-Level Security configurada (policies presentes + RLS
// habilitada). Es el invariante "ningún módulo sirve filas de otro tenant"
// a nivel de catálogo Postgres. Skip si la DB no es accesible.
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'

const DB = {
  host: process.env.PLATFORM_PG_HOST ?? 'localhost',
  port: Number(process.env.PLATFORM_PG_PORT ?? 5432),
  database: process.env.PLATFORM_PG_DB ?? 'splitpay',
  user: process.env.PLATFORM_PG_USER ?? 'splitpay',
  password: process.env.PLATFORM_PG_PASSWORD ?? 'splitpay',
}

// Schemas con datos por tenant que DEBEN tener RLS. (platform_leads queda
// fuera a propósito: los leads del landing son platform-global, sin tenant.)
const TENANT_SCOPED = [
  'platform_auth', 'platform_inquiries', 'platform_donations',
  'platform_orders', 'platform_messaging', 'platform_verifactu',
  'app_aikikan', 'app_aulavera',
]

let client = null
try {
  client = new pg.Client(DB)
  await client.connect()
} catch { client = null }
const maybe = client ? it : it.skip
if (!client) {
  // eslint-disable-next-line no-console
  console.warn(`[rls-smoke] postgres no accesible en ${DB.host}:${DB.port} — tests SKIPeados`)
}
afterAll(async () => { if (client) await client.end().catch(() => {}) })

describe('RLS — policies por schema tenant-scoped', () => {
  maybe('cada schema tenant-scoped tiene ≥1 policy de RLS', async () => {
    const { rows } = await client.query(
      `SELECT schemaname, count(*)::int n FROM pg_policies GROUP BY schemaname`,
    )
    const bySchema = new Map(rows.map((r) => [r.schemaname, r.n]))
    const without = TENANT_SCOPED.filter((s) => !(bySchema.get(s) > 0))
    expect(without, `schemas sin policies RLS: ${without.join(', ')}`).toEqual([])
  })

  maybe('RLS está habilitada (relrowsecurity) en tablas de esos schemas', async () => {
    const { rows } = await client.query(
      `SELECT n.nspname,
              count(*) FILTER (WHERE c.relrowsecurity)::int enabled,
              count(*)::int total
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = ANY($1)
        GROUP BY n.nspname`,
      [TENANT_SCOPED],
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.enabled, `${r.nspname} no tiene ninguna tabla con RLS habilitada`).toBeGreaterThan(0)
    }
  })

  maybe('la GUC de scope (app.tenant_id) se puede fijar en la sesión', async () => {
    // El mecanismo que usan las policies: SET de la GUC de scope. Usamos
    // session-scope (is_local=false) para que persista entre queries del
    // mismo client en autocommit.
    await client.query(`SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', false)`)
    const { rows } = await client.query(`SELECT current_setting('app.tenant_id', true) AS v`)
    expect(rows[0].v).toBe('11111111-1111-1111-1111-111111111111')
  })
})
