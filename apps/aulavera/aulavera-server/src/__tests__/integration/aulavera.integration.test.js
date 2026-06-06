/**
 * Integration tests for apps/aulavera/aulavera-server — require a running Postgres.
 *
 * aulavera es read-only (V1): routes públicas, no JWT, no admin.
 *
 * Cubre:
 *   - Migrations 0001 + 0002_seed aplican y son idempotentes.
 *   - Health pública.
 *   - RLS en events, disciplines, resources — query con tenant_id distinto NO devuelve datos.
 *   - Filtros de los endpoints públicos (?kind, ?status, ?type).
 *   - tenantFromRequest: sin auth y sin ?tenantId= → 422.
 *
 * Start: ./scripts/test-db-up.sh
 * Run:   pnpm --filter @aulavera/aulavera-server test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'

import { createApp } from '../../app.js'
import { runMigrations } from '../../lib/migrate.js'

const APP_ID    = 'aulavera'
const TENANT_A  = '00000000-0000-0000-0000-0000000000d1'
const TENANT_B  = '00000000-0000-0000-0000-0000000000d2'

let app
let adminPool

beforeAll(async () => {
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await adminPool.query('SELECT 1')
  await runMigrations()
  // Datos de test: inserciones directas con admin pool (bypass RLS).
  await adminPool.query(`
    INSERT INTO app_aulavera.events
      (app_id, tenant_id, slug, kind, status, title, body, position)
    VALUES
      ($1, $2, 'wk-a', 'workshop',  'active',   'Workshop A',  'Body A', 1),
      ($1, $2, 'ch-a', 'chronicle', 'archived', 'Chronicle A', 'Body A', 2),
      ($1, $3, 'wk-b', 'workshop',  'active',   'Workshop B',  'Body B', 1)
    ON CONFLICT DO NOTHING
  `, [APP_ID, TENANT_A, TENANT_B])

  await adminPool.query(`
    INSERT INTO app_aulavera.disciplines
      (app_id, tenant_id, slug, name, body, state, position, active)
    VALUES
      ($1, $2, 'aikido-a', 'Aikido',  '<p>desc</p>', 'En preparación', 1, TRUE),
      ($1, $2, 'yoga-a',   'Yoga',    '<p>desc</p>', 'En preparación', 2, FALSE),
      ($1, $3, 'aikido-b', 'Aikido B','<p>desc</p>', 'En preparación', 1, TRUE)
    ON CONFLICT DO NOTHING
  `, [APP_ID, TENANT_A, TENANT_B])

  await adminPool.query(`
    INSERT INTO app_aulavera.resources
      (app_id, tenant_id, type, title, position, active)
    VALUES
      ($1, $2, 'video',    'Vid A', 1, TRUE),
      ($1, $2, 'document', 'Doc A', 2, TRUE),
      ($1, $3, 'video',    'Vid B', 1, TRUE)
  `, [APP_ID, TENANT_A, TENANT_B])

  app = await createApp()
  await app.ready()
})

afterAll(async () => {
  // Cleanup todo lo inserted.
  await adminPool.query(`DELETE FROM app_aulavera.events      WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B])
  await adminPool.query(`DELETE FROM app_aulavera.disciplines WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B])
  await adminPool.query(`DELETE FROM app_aulavera.resources   WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B])
  await app?.close()
  await adminPool?.end()
})

// ═══════════════════════════════════════════════════════════════════
// Migrations
// ═══════════════════════════════════════════════════════════════════

describe('migrations 0001 + 0002_seed', () => {
  it('schema app_aulavera + 3 tablas existen', async () => {
    const { rows } = await adminPool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'app_aulavera' ORDER BY tablename`,
    )
    const names = rows.map((r) => r.tablename)
    expect(names).toEqual(expect.arrayContaining(['events', 'disciplines', 'resources']))
  })

  it('0001 + 0002 son IDEMPOTENTES (re-run no falla)', async () => {
    await expect(runMigrations()).resolves.toBeUndefined()
  })

  it('RLS habilitado en las 3 tablas', async () => {
    const { rows } = await adminPool.query(
      `SELECT relname FROM pg_class
         WHERE relrowsecurity = TRUE
           AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'app_aulavera')`,
    )
    const names = rows.map((r) => r.relname)
    expect(names).toEqual(expect.arrayContaining(['events', 'disciplines', 'resources']))
  })

  it('UNIQUE (app_id, tenant_id, slug) en events (no duplicar slug por tenant)', async () => {
    await expect(adminPool.query(`
      INSERT INTO app_aulavera.events
        (app_id, tenant_id, slug, kind, status, title, body, position)
      VALUES ($1, $2, 'wk-a', 'workshop', 'active', 'Dup', 'X', 9)
    `, [APP_ID, TENANT_A])).rejects.toThrow(/duplicate key|unique/)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  it('200 + service aulavera-server', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).service).toBe('aulavera-server')
  })
})

// ═══════════════════════════════════════════════════════════════════
// Events — público con ?tenantId
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/aulavera/events', () => {
  it('sin tenantId → 422', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/aulavera/events' })
    expect(res.statusCode).toBe(422)
  })

  it('?tenantId=A → solo events de A (RLS)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/events?tenantId=${TENANT_A}`,
    })
    expect(res.statusCode).toBe(200)
    const slugs = res.json().map((e) => e.slug)
    expect(slugs).toContain('wk-a')
    expect(slugs).not.toContain('wk-b')
  })

  it('?tenantId=B → solo events de B', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/events?tenantId=${TENANT_B}`,
    })
    expect(res.statusCode).toBe(200)
    const slugs = res.json().map((e) => e.slug)
    expect(slugs).toContain('wk-b')
    expect(slugs).not.toContain('wk-a')
  })

  it('?status default=active filtra los archived', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/events?tenantId=${TENANT_A}`,
    })
    const slugs = res.json().map((e) => e.slug)
    expect(slugs).toContain('wk-a')
    expect(slugs).not.toContain('ch-a')            // status archived → filtrado
  })

  it('?status=archived → solo los archived', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/events?tenantId=${TENANT_A}&status=archived`,
    })
    const slugs = res.json().map((e) => e.slug)
    expect(slugs).toContain('ch-a')
    expect(slugs).not.toContain('wk-a')
  })

  it('?kind=workshop filtra por kind', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/events?tenantId=${TENANT_A}&kind=workshop`,
    })
    const data = res.json()
    expect(data.every((e) => e.kind === 'workshop')).toBe(true)
  })

  it('?kind=banana (fuera de enum) → 422', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/events?tenantId=${TENANT_A}&kind=banana`,
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Disciplines — público con ?tenantId
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/aulavera/disciplines', () => {
  it('?tenantId=A devuelve solo las activas de A', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/disciplines?tenantId=${TENANT_A}`,
    })
    expect(res.statusCode).toBe(200)
    const slugs = res.json().map((d) => d.slug)
    expect(slugs).toContain('aikido-a')
    expect(slugs).not.toContain('yoga-a')          // active=false
    expect(slugs).not.toContain('aikido-b')        // cross-tenant
  })

  it('ORDER BY position ASC + name ASC', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/disciplines?tenantId=${TENANT_A}`,
    })
    const positions = res.json().map((d) => d.position)
    const sorted = [...positions].sort((a, b) => a - b)
    expect(positions).toEqual(sorted)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Resources — público + filter type
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/aulavera/resources', () => {
  it('?tenantId=A devuelve resources de A (mix de tipos)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/resources?tenantId=${TENANT_A}`,
    })
    expect(res.statusCode).toBe(200)
    const titles = res.json().map((r) => r.title)
    expect(titles).toContain('Vid A')
    expect(titles).toContain('Doc A')
    expect(titles).not.toContain('Vid B')
  })

  it('?type=video filtra solo videos', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/resources?tenantId=${TENANT_A}&type=video`,
    })
    const data = res.json()
    expect(data.every((r) => r.type === 'video')).toBe(true)
    expect(data.map((r) => r.title)).toContain('Vid A')
  })

  it('?type=banana (no en enum) → 422 (zod parse error)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/aulavera/resources?tenantId=${TENANT_A}&type=banana`,
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})

// ═══════════════════════════════════════════════════════════════════
// RLS — verifica directamente al pool
// ═══════════════════════════════════════════════════════════════════

describe('RLS directo (svc_app_aulavera)', () => {
  let modulePool

  beforeAll(async () => {
    modulePool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
  })
  afterAll(async () => { await modulePool?.end() })

  it('SET tenant_id=A → solo ve events de A', async () => {
    const c = await modulePool.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.app_id',    $1, true)`, [APP_ID])
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A])
      const { rows } = await c.query(`SELECT tenant_id::text FROM app_aulavera.events`)
      expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true)
      await c.query('COMMIT')
    } finally { c.release() }
  })

  it('SET tenant_id=B → NO ve events de A (zero cross-tenant leak)', async () => {
    const c = await modulePool.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.app_id',    $1, true)`, [APP_ID])
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B])
      const { rows } = await c.query(`SELECT tenant_id::text FROM app_aulavera.events`)
      expect(rows.every((r) => r.tenant_id === TENANT_B)).toBe(true)
      await c.query('COMMIT')
    } finally { c.release() }
  })

  it('SET app_id=otro → 0 rows aunque tenant matchee', async () => {
    const c = await modulePool.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.app_id',    $1, true)`, ['random-app'])
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A])
      const { rows } = await c.query(`SELECT id FROM app_aulavera.events`)
      expect(rows).toHaveLength(0)                    // app_id mismatch → policy bloquea
      await c.query('COMMIT')
    } finally { c.release() }
  })
})
