/**
 * Integration tests for platform/catalog — require a running Postgres.
 *
 * Start dependencies:  docker compose up postgres -d
 * Run:                 pnpm --filter @apphub/platform-catalog test:integration
 *
 * Tests use APP_ID='int-test' + dedicated TENANT_IDs so cleanup is scoped.
 * RLS is enforced: each tenant only sees its own items.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { createApp } from '../../app.js'

// ── token helper ─────────────────────────────────────────────────────────────

const APP_ID    = 'int-test'
const TENANT_A  = '00000000-0000-0000-0000-000000000010'
const TENANT_B  = '00000000-0000-0000-0000-000000000011'
const USER_ID   = uuidv4()

function makeToken(overrides = {}) {
  const payload = {
    sub: USER_ID, app_id: APP_ID, tenant_id: TENANT_A,
    role: 'admin', email: 'test@test.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}

const TOKEN_A = makeToken({ tenant_id: TENANT_A })
const TOKEN_B = makeToken({ tenant_id: TENANT_B })
const AUTH_A  = { Authorization: `Bearer ${TOKEN_A}` }
const AUTH_B  = { Authorization: `Bearer ${TOKEN_B}` }

// ── setup / teardown ─────────────────────────────────────────────────────────

let app
let adminPool

beforeAll(async () => {
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await adminPool.query('SELECT 1')
  app = createApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await adminPool.end()
})

afterEach(async () => {
  await adminPool.query(
    `DELETE FROM platform_catalog.items WHERE app_id = $1`, [APP_ID],
  )
})

// ── helpers ───────────────────────────────────────────────────────────────────

function itemPayload(overrides = {}) {
  return {
    name:        `Test Item ${uuidv4().slice(0, 8)}`,
    description: 'A test catalog item',
    priceCents:  1000,
    currency:    'eur',
    category:    'test',
    ...overrides,
  }
}

async function createItem(authHeaders = AUTH_A, payload = itemPayload()) {
  const res = await app.inject({ method: 'POST', url: '/v1/items', headers: authHeaders, payload })
  return JSON.parse(res.body)
}

// ═════════════════════════════════════════════════════════════════════════════
// health
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).service).toBe('platform-catalog')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// auth guard
// ═════════════════════════════════════════════════════════════════════════════

describe('auth guard', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/items' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for a malformed token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/items', headers: { Authorization: 'Bearer bad' } })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for an expired token', async () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 })
    const res = await app.inject({ method: 'GET', url: '/v1/items', headers: { Authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /v1/items
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /v1/items', () => {
  it('creates an item and returns 201 with the full object', async () => {
    const payload = itemPayload()
    const res = await app.inject({ method: 'POST', url: '/v1/items', headers: AUTH_A, payload })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.name).toBe(payload.name)
    expect(body.price_cents).toBe(payload.priceCents)
    expect(body.currency).toBe(payload.currency)
    expect(body.category).toBe(payload.category)
    expect(body.app_id).toBe(APP_ID)
    expect(body.tenant_id).toBe(TENANT_A)
    expect(body.active).toBe(true)
  })

  it('stores the item in the database (verifiable via admin pool)', async () => {
    const item = await createItem()
    const { rows } = await adminPool.query(`SELECT * FROM platform_catalog.items WHERE id = $1`, [item.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe(item.name)
    expect(rows[0].tenant_id).toBe(TENANT_A)
    expect(rows[0].app_id).toBe(APP_ID)
  })

  it('creates an item with optional metadata', async () => {
    const payload = itemPayload({ metadata: { color: 'blue', size: 'L' } })
    const res = await app.inject({ method: 'POST', url: '/v1/items', headers: AUTH_A, payload })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.metadata).toMatchObject({ color: 'blue', size: 'L' })
  })

  it('creates an item without optional fields', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/items', headers: AUTH_A,
      payload: { name: 'Minimal Item' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.price_cents).toBe(0)
    expect(body.currency).toBe('eur')
  })

  it('returns 422 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/items', headers: AUTH_A,
      payload: { priceCents: 1000 },
    })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 422 for negative priceCents', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/items', headers: AUTH_A,
      payload: { name: 'X', priceCents: -1 },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/items
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/items', () => {
  it('returns items belonging to the authenticated tenant', async () => {
    await createItem()
    await createItem()
    const res = await app.inject({ method: 'GET', url: '/v1/items', headers: AUTH_A })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(2)
    expect(body.every((i) => i.tenant_id === TENANT_A)).toBe(true)
  })

  it('RLS: tenant A cannot see tenant B items', async () => {
    const itemA = await createItem(AUTH_A)
    const itemB = await createItem(AUTH_B)

    const resA = await app.inject({ method: 'GET', url: '/v1/items', headers: AUTH_A })
    const idsA = JSON.parse(resA.body).map((i) => i.id)
    expect(idsA).toContain(itemA.id)
    expect(idsA).not.toContain(itemB.id)

    const resB = await app.inject({ method: 'GET', url: '/v1/items', headers: AUTH_B })
    const idsB = JSON.parse(resB.body).map((i) => i.id)
    expect(idsB).toContain(itemB.id)
    expect(idsB).not.toContain(itemA.id)
  })

  it('only returns active items by default', async () => {
    const item = await createItem()
    await app.inject({
      method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A,
      payload: { active: false },
    })
    const res = await app.inject({ method: 'GET', url: '/v1/items', headers: AUTH_A })
    const ids = JSON.parse(res.body).map((i) => i.id)
    expect(ids).not.toContain(item.id)
  })

  it('includes inactive items when activeOnly=false', async () => {
    const item = await createItem()
    await app.inject({
      method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A,
      payload: { active: false },
    })
    const res = await app.inject({ method: 'GET', url: '/v1/items?activeOnly=false', headers: AUTH_A })
    const ids = JSON.parse(res.body).map((i) => i.id)
    expect(ids).toContain(item.id)
  })

  it('returns empty array when tenant has no items', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/items', headers: AUTH_A })
    expect(JSON.parse(res.body)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/items/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/items/:id', () => {
  it('returns the item when it belongs to the tenant', async () => {
    const item = await createItem()
    const res = await app.inject({ method: 'GET', url: `/v1/items/${item.id}`, headers: AUTH_A })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).id).toBe(item.id)
  })

  it('returns 404 for an item belonging to a different tenant (RLS)', async () => {
    const itemB = await createItem(AUTH_B)
    const res = await app.inject({ method: 'GET', url: `/v1/items/${itemB.id}`, headers: AUTH_A })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for a random UUID', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/items/${uuidv4()}`, headers: AUTH_A })
    expect(res.statusCode).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /v1/items/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /v1/items/:id', () => {
  it('updates allowed fields and returns the updated item', async () => {
    const item = await createItem()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A,
      payload: { name: 'Updated Name', priceCents: 2500, category: 'premium' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.name).toBe('Updated Name')
    expect(body.price_cents).toBe(2500)
    expect(body.category).toBe('premium')
  })

  it('can deactivate an item', async () => {
    const item = await createItem()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A,
      payload: { active: false },
    })
    expect(JSON.parse(res.body).active).toBe(false)
  })

  it('can reactivate an item', async () => {
    const item = await createItem()
    await app.inject({ method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A, payload: { active: false } })
    const res = await app.inject({ method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A, payload: { active: true } })
    expect(JSON.parse(res.body).active).toBe(true)
  })

  it('returns 404 for an item belonging to a different tenant (RLS)', async () => {
    const itemB = await createItem(AUTH_B)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${itemB.id}`, headers: AUTH_A,
      payload: { name: 'Stolen' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${uuidv4()}`, headers: AUTH_A,
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 422 for negative priceCents', async () => {
    const item = await createItem()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${item.id}`, headers: AUTH_A,
      payload: { priceCents: -5 },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /v1/items/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /v1/items/:id', () => {
  it('deletes the item and returns 204', async () => {
    const item = await createItem()
    const res = await app.inject({ method: 'DELETE', url: `/v1/items/${item.id}`, headers: AUTH_A })
    expect(res.statusCode).toBe(204)

    // Confirm it is gone
    const get = await app.inject({ method: 'GET', url: `/v1/items/${item.id}`, headers: AUTH_A })
    expect(get.statusCode).toBe(404)
  })

  it('is removed from DB (verifiable via admin pool)', async () => {
    const item = await createItem()
    await app.inject({ method: 'DELETE', url: `/v1/items/${item.id}`, headers: AUTH_A })
    const { rows } = await adminPool.query(`SELECT id FROM platform_catalog.items WHERE id = $1`, [item.id])
    expect(rows).toHaveLength(0)
  })

  it('returns 404 for item belonging to a different tenant (RLS)', async () => {
    const itemB = await createItem(AUTH_B)
    const res = await app.inject({ method: 'DELETE', url: `/v1/items/${itemB.id}`, headers: AUTH_A })
    expect(res.statusCode).toBe(404)
    // item still exists
    const { rows } = await adminPool.query(`SELECT id FROM platform_catalog.items WHERE id = $1`, [itemB.id])
    expect(rows).toHaveLength(1)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/items/${uuidv4()}`, headers: AUTH_A })
    expect(res.statusCode).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// unknown routes
// ═════════════════════════════════════════════════════════════════════════════

describe('unknown routes', () => {
  it('returns 404 with NOT_FOUND code', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope', headers: AUTH_A })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND')
  })
})
