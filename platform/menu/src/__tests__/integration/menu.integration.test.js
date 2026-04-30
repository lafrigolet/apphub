/**
 * Integration tests for platform/menu — require a running Postgres + Redis.
 *
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-menu test:integration
 *
 * Tests use APP_ID 'int-test-menu' so cleanup is scoped and never touches
 * production data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createMenu, getMenu, listMenus, listAvailableItems,
  createCategory, createItem, updateItem,
  eightySixItem, unEightySixItem, publishMenu,
  createAvailabilityWindow,
} from '../../services/menu.service.js'
import { NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-menu'
const TENANT_ID = '00000000-0000-0000-0000-0000000000a1'

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
  await adminPool.query(`DELETE FROM platform_menu.availability_windows WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_menu.modifiers WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_menu.modifier_groups WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_menu.menu_items WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_menu.menu_categories WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_menu.menus WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'admin', ...overrides,
})

// ── menus ──────────────────────────────────────────────────────────────
describe('menus', () => {
  it('creates a menu and reads it back', async () => {
    const m = await createMenu(ctx(), { name: 'Lunch', description: 'Comida' })
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(m.app_id).toBe(APP_ID)
    expect(m.tenant_id).toBe(TENANT_ID)

    const all = await listMenus(ctx())
    expect(all.find((x) => x.id === m.id)).toBeTruthy()
  })

  it('getMenu returns categories and items', async () => {
    const m = await createMenu(ctx(), { name: 'Cena' })
    const c = await createCategory(ctx(), { menuId: m.id, name: 'Mains', courseType: 'main' })
    const item = await createItem(ctx(), { categoryId: c.id, sku: 'BURG-' + uuidv4(), name: 'Burger', priceCents: 1000 })

    const full = await getMenu(ctx(), m.id)
    expect(full.categories).toHaveLength(1)
    expect(full.categories[0].items).toHaveLength(1)
    expect(full.categories[0].items[0].id).toBe(item.id)
  })

  it('getMenu throws NotFoundError for unknown id', async () => {
    await expect(getMenu(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

// ── tenant isolation (RLS) ─────────────────────────────────────────────
describe('tenant isolation', () => {
  it('listMenus only returns menus for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-0000000000a2'
    await createMenu(ctx(), { name: 'A' })
    await createMenu(ctx({ tenantId: T2 }), { name: 'B' })
    const list = await listMenus(ctx())
    expect(list.every((m) => m.tenant_id === TENANT_ID)).toBe(true)
    // cleanup the cross-tenant row
    await adminPool.query(`DELETE FROM platform_menu.menus WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})

// ── eighty-six flow ────────────────────────────────────────────────────
describe('eighty-six flow', () => {
  it('marks item 86ed and unmarks it; listAvailableItems excludes 86ed items', async () => {
    const m = await createMenu(ctx(), { name: 'A' })
    const c = await createCategory(ctx(), { menuId: m.id, name: 'Mains', courseType: 'main' })
    const i = await createItem(ctx(), { categoryId: c.id, sku: 'X-' + uuidv4(), name: 'X', priceCents: 100 })

    let avail = await listAvailableItems(ctx(), m.id)
    expect(avail.map((x) => x.id)).toContain(i.id)

    await eightySixItem(ctx(), i.id)
    avail = await listAvailableItems(ctx(), m.id)
    expect(avail.map((x) => x.id)).not.toContain(i.id)

    await unEightySixItem(ctx(), i.id)
    avail = await listAvailableItems(ctx(), m.id)
    expect(avail.map((x) => x.id)).toContain(i.id)
  })

  it('eightySixItem throws NotFoundError on unknown id', async () => {
    await expect(eightySixItem(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

// ── 86-list event flows over Redis ─────────────────────────────────────
describe('redis events', () => {
  it('publishes menu.item.eighty_sixed when an item is 86ed', async () => {
    const m = await createMenu(ctx(), { name: 'EvtMenu' })
    const c = await createCategory(ctx(), { menuId: m.id, name: 'Mains', courseType: 'main' })
    const i = await createItem(ctx(), { categoryId: c.id, sku: 'EVT-' + uuidv4(), name: 'X', priceCents: 100 })

    const sub = new Redis(process.env.REDIS_URL)
    const received = []
    await sub.subscribe('platform.events')
    sub.on('message', (_chan, raw) => {
      try { received.push(JSON.parse(raw)) } catch {}
    })
    // small delay so subscription is active
    await new Promise((r) => setTimeout(r, 50))

    try {
      await eightySixItem(ctx(), i.id)

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !received.some((e) => e.type === 'menu.item.eighty_sixed')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const evt = received.find((e) => e.type === 'menu.item.eighty_sixed')
      expect(evt).toBeTruthy()
      expect(evt.payload.itemId).toBe(i.id)
      expect(evt.payload.tenantId).toBe(TENANT_ID)
    } finally {
      sub.disconnect()
    }
  })

  it('publishes menu.published when publishMenu is called', async () => {
    const m = await createMenu(ctx(), { name: 'Published' })

    const sub = new Redis(process.env.REDIS_URL)
    const received = []
    await sub.subscribe('platform.events')
    sub.on('message', (_chan, raw) => {
      try { received.push(JSON.parse(raw)) } catch {}
    })
    await new Promise((r) => setTimeout(r, 50))

    try {
      await publishMenu(ctx(), m.id)
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !received.some((e) => e.type === 'menu.published')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(received.find((e) => e.type === 'menu.published')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

// ── updateItem ─────────────────────────────────────────────────────────
describe('updateItem', () => {
  it('updates only the provided fields', async () => {
    const m = await createMenu(ctx(), { name: 'M' })
    const c = await createCategory(ctx(), { menuId: m.id, name: 'X', courseType: 'main' })
    const i = await createItem(ctx(), { categoryId: c.id, sku: 'U-' + uuidv4(), name: 'X', priceCents: 100 })
    const updated = await updateItem(ctx(), i.id, { priceCents: 250, station: 'caliente' })
    expect(updated.price_cents).toBe('250')      // pg returns BIGINT as string
    expect(updated.station).toBe('caliente')
    expect(updated.name).toBe('X')               // unchanged
  })

  it('throws NotFoundError for unknown id', async () => {
    await expect(updateItem(ctx(), uuidv4(), { priceCents: 100 })).rejects.toThrow(NotFoundError)
  })
})

// ── availability windows ───────────────────────────────────────────────
describe('availability windows', () => {
  it('persists availability windows scoped by (scope_type, scope_id)', async () => {
    const m = await createMenu(ctx(), { name: 'M' })
    const w = await createAvailabilityWindow(ctx(), {
      scopeType: 'menu', scopeId: m.id,
      daysOfWeek: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 720, label: 'desayuno',
    })
    expect(w.scope_id).toBe(m.id)
    expect(w.start_minute).toBe(480)
  })
})
