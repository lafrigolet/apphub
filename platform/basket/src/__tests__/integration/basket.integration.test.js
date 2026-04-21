/**
 * Integration tests for platform/basket — require a running Redis.
 *
 * Start dependencies:  docker compose up redis -d
 * Run:                 pnpm --filter @apphub/platform-basket test:integration
 *
 * Basket data lives in Redis keys basket:{appId}:{tenantId}:{userId}.
 * Tests use distinct user/tenant IDs to avoid inter-test collisions.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { createApp } from '../../app.js'

// ── token helper ─────────────────────────────────────────────────────────────

const APP_ID   = 'int-test'
const TENANT_A = '00000000-0000-0000-0000-000000000010'
const TENANT_B = '00000000-0000-0000-0000-000000000011'
const USER_1   = uuidv4()
const USER_2   = uuidv4()

function makeToken(overrides = {}) {
  const payload = {
    sub: USER_1, app_id: APP_ID, tenant_id: TENANT_A,
    role: 'user', email: 'test@test.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}

const TOKEN_U1 = makeToken({ sub: USER_1, tenant_id: TENANT_A })
const TOKEN_U2 = makeToken({ sub: USER_2, tenant_id: TENANT_A })
const TOKEN_TB = makeToken({ sub: USER_1, tenant_id: TENANT_B })
const AUTH_U1  = { Authorization: `Bearer ${TOKEN_U1}` }
const AUTH_U2  = { Authorization: `Bearer ${TOKEN_U2}` }
const AUTH_TB  = { Authorization: `Bearer ${TOKEN_TB}` }

// ── setup / teardown ─────────────────────────────────────────────────────────

let app
let redis

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL)
  await redis.ping()
  app = createApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await redis.quit()
})

afterEach(async () => {
  // Wipe all basket keys created by these tests
  const keys = await redis.keys(`basket:${APP_ID}:*`)
  if (keys.length) await redis.del(...keys)
})

// ── helpers ───────────────────────────────────────────────────────────────────

function item(overrides = {}) {
  return {
    itemId:     uuidv4(),
    quantity:   1,
    name:       `Item ${uuidv4().slice(0, 6)}`,
    priceCents: 500,
    ...overrides,
  }
}

async function addItem(authHeaders = AUTH_U1, payload = item()) {
  const res = await app.inject({ method: 'PUT', url: '/v1/basket/items', headers: authHeaders, payload })
  return { res, body: JSON.parse(res.body) }
}

// ═════════════════════════════════════════════════════════════════════════════
// health
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).service).toBe('platform-basket')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// auth guard
// ═════════════════════════════════════════════════════════════════════════════

describe('auth guard', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/basket' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for a malformed token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: { Authorization: 'Bearer x.y' } })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for an expired token', async () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 1 })
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: { Authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/basket — empty basket
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/basket', () => {
  it('returns an empty basket when no items have been added', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U1 })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ items: [] })
  })

  it('returns basket contents after items are added', async () => {
    const i = item()
    await addItem(AUTH_U1, i)
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U1 })
    const body = JSON.parse(res.body)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].itemId).toBe(i.itemId)
    expect(body.items[0].quantity).toBe(i.quantity)
    expect(body.items[0].priceCents).toBe(i.priceCents)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PUT /v1/basket/items
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /v1/basket/items', () => {
  it('adds a new item to an empty basket', async () => {
    const i = item()
    const { res, body } = await addItem(AUTH_U1, i)
    expect(res.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ itemId: i.itemId, quantity: i.quantity, name: i.name, priceCents: i.priceCents })
  })

  it('adds multiple different items', async () => {
    await addItem(AUTH_U1, item())
    await addItem(AUTH_U1, item())
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U1 })
    expect(JSON.parse(res.body).items).toHaveLength(2)
  })

  it('updates quantity when adding an existing itemId', async () => {
    const i = item()
    await addItem(AUTH_U1, i)
    const { body } = await addItem(AUTH_U1, { ...i, quantity: 5, priceCents: 750 })
    expect(body.items).toHaveLength(1)
    expect(body.items[0].quantity).toBe(5)
    expect(body.items[0].priceCents).toBe(750)
  })

  it('stores metadata when provided', async () => {
    const i = item({ metadata: { size: 'M', color: 'red' } })
    const { body } = await addItem(AUTH_U1, i)
    expect(body.items[0].metadata).toMatchObject({ size: 'M', color: 'red' })
  })

  it('returns 422 when itemId is missing', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: AUTH_U1,
      payload: { quantity: 1, name: 'X', priceCents: 100 },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when quantity < 1', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: AUTH_U1,
      payload: { ...item(), quantity: 0 },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when priceCents is negative', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/basket/items', headers: AUTH_U1,
      payload: { ...item(), priceCents: -1 },
    })
    expect(res.statusCode).toBe(422)
  })

  it('user isolation: user1 basket does not affect user2 basket', async () => {
    const i = item()
    await addItem(AUTH_U1, i)
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U2 })
    expect(JSON.parse(res.body).items).toHaveLength(0)
  })

  it('tenant isolation: same user different tenant has separate basket', async () => {
    const i = item()
    await addItem(AUTH_U1, i)
    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_TB })
    expect(JSON.parse(res.body).items).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /v1/basket/items/:itemId
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /v1/basket/items/:itemId', () => {
  it('removes a specific item and returns updated basket', async () => {
    const i1 = item()
    const i2 = item()
    await addItem(AUTH_U1, i1)
    await addItem(AUTH_U1, i2)

    const res = await app.inject({ method: 'DELETE', url: `/v1/basket/items/${i1.itemId}`, headers: AUTH_U1 })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].itemId).toBe(i2.itemId)
  })

  it('returns empty basket after removing the last item', async () => {
    const i = item()
    await addItem(AUTH_U1, i)
    const res = await app.inject({ method: 'DELETE', url: `/v1/basket/items/${i.itemId}`, headers: AUTH_U1 })
    expect(JSON.parse(res.body).items).toHaveLength(0)
  })

  it('is idempotent — removing a non-existent itemId returns the unchanged basket', async () => {
    await addItem(AUTH_U1, item())
    const res = await app.inject({
      method: 'DELETE', url: `/v1/basket/items/${uuidv4()}`, headers: AUTH_U1,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).items).toHaveLength(1)
  })

  it('returns empty basket when removing from an already-empty basket', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/v1/basket/items/${uuidv4()}`, headers: AUTH_U1,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).items).toHaveLength(0)
  })

  it('does not affect another user basket', async () => {
    const i = item()
    await addItem(AUTH_U1, i)
    await addItem(AUTH_U2, i)
    await app.inject({ method: 'DELETE', url: `/v1/basket/items/${i.itemId}`, headers: AUTH_U1 })

    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U2 })
    expect(JSON.parse(res.body).items).toHaveLength(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /v1/basket
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /v1/basket', () => {
  it('clears all items and returns 204', async () => {
    await addItem(AUTH_U1, item())
    await addItem(AUTH_U1, item())
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket', headers: AUTH_U1 })
    expect(res.statusCode).toBe(204)

    const get = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U1 })
    expect(JSON.parse(get.body)).toEqual({ items: [] })
  })

  it('is idempotent on an already-empty basket', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/basket', headers: AUTH_U1 })
    expect(res.statusCode).toBe(204)
  })

  it('removes the Redis key entirely', async () => {
    await addItem(AUTH_U1, item())
    await app.inject({ method: 'DELETE', url: '/v1/basket', headers: AUTH_U1 })
    const keys = await redis.keys(`basket:${APP_ID}:${TENANT_A}:${USER_1}`)
    expect(keys).toHaveLength(0)
  })

  it('does not clear another user basket', async () => {
    await addItem(AUTH_U1, item())
    await addItem(AUTH_U2, item())
    await app.inject({ method: 'DELETE', url: '/v1/basket', headers: AUTH_U1 })

    const res = await app.inject({ method: 'GET', url: '/v1/basket', headers: AUTH_U2 })
    expect(JSON.parse(res.body).items).toHaveLength(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// unknown routes
// ═════════════════════════════════════════════════════════════════════════════

describe('unknown routes', () => {
  it('returns 404 with NOT_FOUND code', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope', headers: AUTH_U1 })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND')
  })
})
