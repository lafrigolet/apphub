/**
 * RLS integration test — contrato duro CLAUDE.md #1 / #2:
 *   "Never remove tenant_id scoping" + "Always include app_id scoping"
 *
 * Verifica que Row Level Security efectivamente impide a un user de
 * (appA, tenantA) leer rows de (appB, tenantB), incluso si la consulta
 * SQL no filtra explícitamente. La política de RLS depende de los GUCs
 * `app.app_id` y `app.tenant_id` que pone `setTenantContext()`.
 *
 * Levanta deps:  docker compose up postgres redis -d
 * Corre:         pnpm --filter @apphub/platform-auth test:integration
 *
 * Nota: la sesión Postgres usa el rol `svc_platform_auth` (DATABASE_URL).
 * El superuser (MIGRATION_DATABASE_URL) está sujeto a `FORCE ROW LEVEL
 * SECURITY` también — así que ambos respetan la política.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'

const APP_A    = 'rls-test-a'
const APP_B    = 'rls-test-b'
const TENANT_A = '00000000-0000-0000-0000-0000000000a1'
const TENANT_B = '00000000-0000-0000-0000-0000000000b1'

let adminPool   // superuser
let runtimePool // svc_platform_auth, RLS enforced
let dbAvailable = false

beforeAll(async () => {
  try {
    adminPool = new pg.Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
      connectionTimeoutMillis: 2000,
    })
    await adminPool.query('SELECT 1')
    dbAvailable = true
  } catch {
    dbAvailable = false
    if (adminPool) { await adminPool.end().catch(() => {}); adminPool = null }
    console.warn('[rls.integration] DB not reachable — tests will skip. Run inside docker network or expose port 5432.')
  }
})

afterAll(async () => {
  if (adminPool)   await adminPool.end().catch(() => {})
  if (runtimePool) await runtimePool.end().catch(() => {})
})

afterEach(async () => {
  if (!dbAvailable) return
  await adminPool.query(`DELETE FROM platform_auth.users WHERE app_id IN ($1, $2)`, [APP_A, APP_B])
})

function skipIfNoDb(t) {
  if (!dbAvailable) { t.skip(); return true }
  return false
}

describe('RLS — aislamiento por (app_id, tenant_id)', () => {
  it(
    'sin GUC seteado, NO se ven rows (FORCE RLS)',
    async (t) => {
      if (skipIfNoDb(t)) return
      runtimePool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const userIdA = uuidv4()
      const hash    = await bcrypt.hash('x', 4)

      // Insert con superuser (BYPASSRLS).
      await adminPool.query(
        `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'user')`,
        [userIdA, APP_A, TENANT_A, `a-${userIdA}@x`, hash],
      )

      const client = await runtimePool.connect()
      try {
        // Sin SET app.app_id / app.tenant_id → la política filtra todo.
        const { rows } = await client.query(
          `SELECT id FROM platform_auth.users WHERE id = $1`, [userIdA],
        )
        expect(rows).toHaveLength(0)
      } finally { client.release() }
    },
  )

  it(
    'con GUC = (app_A, tenant_A), ve solo rows de A; user B invisible',
    async (t) => {
      if (skipIfNoDb(t)) return
      runtimePool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const userA = uuidv4()
      const userB = uuidv4()
      const hash  = await bcrypt.hash('x', 4)

      await adminPool.query(
        `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'user'),
                ($6, $7, $8, $9, $5, 'user')`,
        [userA, APP_A, TENANT_A, `a-${userA}@x`, hash, userB, APP_B, TENANT_B, `b-${userB}@x`],
      )

      const client = await runtimePool.connect()
      try {
        await client.query(`SELECT set_config('app.app_id',    $1, false)`, [APP_A])
        await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_A])
        const { rows } = await client.query(
          `SELECT id, app_id FROM platform_auth.users WHERE id IN ($1, $2)`,
          [userA, userB],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toBe(userA)
      } finally { client.release() }
    },
  )

  it(
    'mismo tenant_id pero distinto app_id → invisible (regla CLAUDE.md #2)',
    async (t) => {
      if (skipIfNoDb(t)) return
      runtimePool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const sameTenant = TENANT_A
      const userA = uuidv4()
      const userB = uuidv4()   // same tenant uuid, distinta app
      const hash  = await bcrypt.hash('x', 4)

      await adminPool.query(
        `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'user'),
                ($6, $7, $3, $8, $5, 'user')`,
        [userA, APP_A, sameTenant, `a-${userA}@x`, hash, userB, APP_B, `b-${userB}@x`],
      )

      const client = await runtimePool.connect()
      try {
        await client.query(`SELECT set_config('app.app_id',    $1, false)`, [APP_A])
        await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [sameTenant])
        const { rows } = await client.query(`SELECT id FROM platform_auth.users WHERE id IN ($1, $2)`, [userA, userB])
        expect(rows.map(r => r.id)).toEqual([userA])
      } finally { client.release() }
    },
  )

  it(
    'INSERT con contexto B intentando spoof app_id=A → fila visible solo a B (RLS at insert/update vía USING + WITH CHECK)',
    async (t) => {
      if (skipIfNoDb(t)) return
      runtimePool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const userId = uuidv4()
      const hash   = await bcrypt.hash('x', 4)

      const client = await runtimePool.connect()
      try {
        // Seteamos contexto B pero intentamos INSERT con app_id=A. El
        // WITH CHECK de la política rechaza la inserción.
        await client.query(`SELECT set_config('app.app_id',    $1, false)`, [APP_B])
        await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_B])
        await expect(
          client.query(
            `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role)
             VALUES ($1, $2, $3, $4, $5, 'user')`,
            [userId, APP_A, TENANT_A, `spoof-${userId}@x`, hash],
          ),
        ).rejects.toThrow(/row-level security|policy/i)
      } finally { client.release() }
    },
  )
})
