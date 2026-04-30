/**
 * Integration tests for platform/floor-plan — require a running Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-floor-plan test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createSection, listSections, createTable, listTables, getTable,
  changeTableStatus, combineTables,
} from '../../services/floor-plan.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-fp'
const TENANT_ID = '00000000-0000-0000-0000-0000000000b1'

let adminPool
let redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_floor_plan.table_events WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_floor_plan.tables       WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_floor_plan.sections     WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'host', ...overrides,
})

describe('sections / tables', () => {
  it('creates section + tables and lists them', async () => {
    const s = await createSection(ctx(), { name: 'Sala', isOutdoor: false })
    expect(s.app_id).toBe(APP_ID)
    const t = await createTable(ctx(), { sectionId: s.id, code: 'T1', capacity: 4 })

    const sections = await listSections(ctx())
    expect(sections.find((x) => x.id === s.id)).toBeTruthy()

    const tables = await listTables(ctx(), { sectionId: s.id })
    expect(tables.map((x) => x.id)).toContain(t.id)
  })

  it('listTables filters by status', async () => {
    const s = await createSection(ctx(), { name: 'Sala' })
    await createTable(ctx(), { sectionId: s.id, code: 'A', capacity: 2 })
    await createTable(ctx(), { sectionId: s.id, code: 'B', capacity: 4 })
    const free = await listTables(ctx(), { status: 'free' })
    expect(free.length).toBeGreaterThanOrEqual(2)
  })

  it('getTable throws NotFoundError on unknown id', async () => {
    await expect(getTable(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('enforces unique table code per (app, tenant)', async () => {
    const s = await createSection(ctx(), { name: 'X' })
    await createTable(ctx(), { sectionId: s.id, code: 'DUP', capacity: 2 })
    await expect(createTable(ctx(), { sectionId: s.id, code: 'DUP', capacity: 4 })).rejects.toThrow()
  })
})

describe('changeTableStatus FSM', () => {
  it('walks through free → reserved → occupied → dirty → free with audit trail', async () => {
    const s = await createSection(ctx(), { name: 'Sala' })
    const t = await createTable(ctx(), { sectionId: s.id, code: 'T-' + uuidv4().slice(0, 6), capacity: 2 })

    await changeTableStatus(ctx(), t.id, 'reserved', { reservationId: uuidv4(), partySize: 2 })
    await changeTableStatus(ctx(), t.id, 'occupied')
    await changeTableStatus(ctx(), t.id, 'dirty')
    await changeTableStatus(ctx(), t.id, 'free')

    const after = await getTable(ctx(), t.id)
    expect(after.status).toBe('free')

    const { rows } = await adminPool.query(
      `SELECT to_status FROM platform_floor_plan.table_events
       WHERE app_id = $1 AND table_id = $2 ORDER BY ts ASC`,
      [APP_ID, t.id],
    )
    expect(rows.map((r) => r.to_status)).toEqual(['reserved', 'occupied', 'dirty', 'free'])
  })

  it('rejects invalid transitions', async () => {
    const s = await createSection(ctx(), { name: 'Sala' })
    const t = await createTable(ctx(), { sectionId: s.id, code: 'INV-' + uuidv4().slice(0, 4), capacity: 2 })
    await expect(changeTableStatus(ctx(), t.id, 'dirty')).rejects.toThrow(ConflictError)
  })
})

describe('combineTables', () => {
  it('records combined tables and emits table.combined', async () => {
    const s = await createSection(ctx(), { name: 'Sala' })
    const a = await createTable(ctx(), { sectionId: s.id, code: 'A-' + uuidv4().slice(0, 4), capacity: 2 })
    const b = await createTable(ctx(), { sectionId: s.id, code: 'B-' + uuidv4().slice(0, 4), capacity: 2 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const updated = await combineTables(ctx(), a.id, [b.id])
      expect(updated.combined_with).toEqual([b.id])
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'table.combined')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'table.combined')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

describe('tenant isolation', () => {
  it('listTables only returns tables for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-0000000000b2'
    const s = await createSection(ctx(), { name: 'Sala' })
    await createTable(ctx(), { sectionId: s.id, code: 'OWN-' + uuidv4().slice(0, 4), capacity: 2 })

    // Cross-tenant section + table — must NOT appear when querying as TENANT_ID.
    const s2 = await createSection(ctx({ tenantId: T2 }), { name: 'Sala2' })
    await createTable(ctx({ tenantId: T2 }), { sectionId: s2.id, code: 'OTHER-' + uuidv4().slice(0, 4), capacity: 2 })

    const own = await listTables(ctx())
    expect(own.every((t) => t.tenant_id === TENANT_ID)).toBe(true)

    await adminPool.query(`DELETE FROM platform_floor_plan.tables   WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
    await adminPool.query(`DELETE FROM platform_floor_plan.sections WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})
