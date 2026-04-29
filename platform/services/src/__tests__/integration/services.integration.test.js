/**
 * Integration tests for platform/services — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-services test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createService, getService, listServices, updateService, deactivateService,
  createCategory, listCategories,
} from '../../services/services.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-svc'
const TENANT_ID = '00000000-0000-0000-0000-0000000002a1'

let adminPool, redis

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
  await adminPool.query(`DELETE FROM platform_services.services   WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_services.categories WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'admin', ...overrides,
})

describe('createService', () => {
  it('persists with sensible defaults', async () => {
    const s = await createService(ctx(), { code: 'CONS-' + uuidv4().slice(0, 4), name: 'Consultation', durationMinutes: 30 })
    expect(s.app_id).toBe(APP_ID)
    expect(s.modality).toBe('in_person')
    expect(s.is_active).toBe(true)
    expect(Number(s.price_cents)).toBe(0)
  })

  it('rejects duplicate (app, tenant, code)', async () => {
    const code = 'DUP-' + uuidv4().slice(0, 4)
    await createService(ctx(), { code, name: 'A', durationMinutes: 30 })
    await expect(createService(ctx(), { code, name: 'B', durationMinutes: 30 })).rejects.toThrow(ConflictError)
  })

  it('emits service.published on Redis', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))
    try {
      const s = await createService(ctx(), { code: 'EVT-' + uuidv4().slice(0, 4), name: 'X', durationMinutes: 30 })
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'service.published' && e.payload.serviceId === s.id)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'service.published' && e.payload.serviceId === s.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

describe('getService / listServices / updateService', () => {
  it('getService throws NotFoundError on unknown id', async () => {
    await expect(getService(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('listServices filters by category and is_active', async () => {
    await createService(ctx(), { code: 'A-' + uuidv4().slice(0, 4), name: 'A', durationMinutes: 30, category: 'foo' })
    await createService(ctx(), { code: 'B-' + uuidv4().slice(0, 4), name: 'B', durationMinutes: 30, category: 'bar' })
    const foo = await listServices(ctx(), { category: 'foo' })
    expect(foo.every((s) => s.category === 'foo')).toBe(true)
  })

  it('updateService changes fields', async () => {
    const s = await createService(ctx(), { code: 'U-' + uuidv4().slice(0, 4), name: 'A', durationMinutes: 30 })
    const updated = await updateService(ctx(), s.id, { name: 'B', durationMinutes: 45 })
    expect(updated.name).toBe('B')
    expect(updated.duration_minutes).toBe(45)
  })

  it('updateService throws NotFoundError on unknown id', async () => {
    await expect(updateService(ctx(), uuidv4(), { name: 'X' })).rejects.toThrow(NotFoundError)
  })
})

describe('deactivateService', () => {
  it('flips is_active to FALSE and emits service.deprecated', async () => {
    const s = await createService(ctx(), { code: 'D-' + uuidv4().slice(0, 4), name: 'X', durationMinutes: 30 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))
    try {
      const after = await deactivateService(ctx(), s.id)
      expect(after.is_active).toBe(false)
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'service.deprecated' && e.payload.serviceId === s.id)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'service.deprecated' && e.payload.serviceId === s.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

describe('categories', () => {
  it('persists and lists', async () => {
    await createCategory(ctx(), { name: 'Mains', displayOrder: 1 })
    await createCategory(ctx(), { name: 'Drinks', displayOrder: 2 })
    const all = await listCategories(ctx())
    expect(all.length).toBeGreaterThanOrEqual(2)
  })
})

describe('tenant isolation', () => {
  it('listServices only returns services for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-0000000002a2'
    await createService(ctx(),                   { code: 'OWN-' + uuidv4().slice(0, 4), name: 'mine', durationMinutes: 30 })
    await createService(ctx({ tenantId: T2 }),    { code: 'OTH-' + uuidv4().slice(0, 4), name: 'other', durationMinutes: 30 })
    const own = await listServices(ctx())
    expect(own.every((s) => s.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_services.services WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
