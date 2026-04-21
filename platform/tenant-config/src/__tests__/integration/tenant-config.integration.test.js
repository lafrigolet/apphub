/**
 * Integration tests for platform/tenant-config — require a running Postgres.
 *
 * Start dependencies:  docker compose up postgres -d
 * Run:                 pnpm --filter @apphub/platform-tenant-config test:integration
 *
 * Tests use app_ids prefixed with 'int-test-' so cleanup never touches seed data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { createApp } from '../../app.js'

// ── token helper ─────────────────────────────────────────────────────────────
// appGuard decodes the JWT payload from Base64 without verifying the signature.

function makeToken(overrides = {}) {
  const payload = {
    sub: uuidv4(), app_id: 'yoga-studio', tenant_id: uuidv4(),
    role: 'admin', email: 'test@test.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}

const TOKEN = makeToken()
const AUTH  = { Authorization: `Bearer ${TOKEN}` }

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
  // Remove test tenants then test apps (FK order)
  await adminPool.query(`DELETE FROM platform_tenants.tenants WHERE app_id LIKE 'int-test-%'`)
  await adminPool.query(`DELETE FROM platform_tenants.apps    WHERE app_id LIKE 'int-test-%'`)
})

// ── helpers ───────────────────────────────────────────────────────────────────

function testApp(suffix = uuidv4().slice(0, 8)) {
  return {
    appId:       `int-test-${suffix}`,
    displayName: `Int Test App ${suffix}`,
    subdomain:   `int-test-${suffix}`,
    jwtAudience: `int-test-${suffix}`,
  }
}

function testTenant(appId, suffix = uuidv4().slice(0, 8)) {
  return { appId, displayName: `Int Test Tenant ${suffix}`, subdomain: `int-tenant-${suffix}` }
}

async function seedApp(attrs = testApp()) {
  const res = await app.inject({ method: 'POST', url: '/v1/apps', headers: AUTH, payload: attrs })
  return JSON.parse(res.body)
}

async function seedTenant(appId, attrs) {
  const res = await app.inject({ method: 'POST', url: '/v1/tenants', headers: AUTH, payload: attrs ?? testTenant(appId) })
  return JSON.parse(res.body)
}

// ═════════════════════════════════════════════════════════════════════════════
// health
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('platform-tenant-config')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// auth guard
// ═════════════════════════════════════════════════════════════════════════════

describe('auth guard', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/apps' })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 for a malformed token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/apps', headers: { Authorization: 'Bearer not.a.token' } })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for an expired token', async () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 10 })
    const res = await app.inject({ method: 'GET', url: '/v1/apps', headers: { Authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })

  it('accepts any app_id when EXPECTED_APP_ID=platform', async () => {
    const token = makeToken({ app_id: 'split-pay' })
    const res = await app.inject({ method: 'GET', url: '/v1/apps', headers: { Authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/apps
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/apps', () => {
  it('returns an array containing the seeded apps', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/apps', headers: AUTH })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    const appIds = body.map((a) => a.app_id)
    expect(appIds).toContain('yoga-studio')
    expect(appIds).toContain('split-pay')
  })

  it('includes newly created apps', async () => {
    const created = await seedApp()
    const res = await app.inject({ method: 'GET', url: '/v1/apps', headers: AUTH })
    const body = JSON.parse(res.body)
    expect(body.some((a) => a.app_id === created.app_id)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /v1/apps
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /v1/apps', () => {
  it('creates an app and returns 201 with the app object', async () => {
    const attrs = testApp()
    const res = await app.inject({ method: 'POST', url: '/v1/apps', headers: AUTH, payload: attrs })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.app_id).toBe(attrs.appId)
    expect(body.display_name).toBe(attrs.displayName)
    expect(body.subdomain).toBe(attrs.subdomain)
    expect(body.status).toBe('active')
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns 409 on duplicate app_id', async () => {
    const attrs = testApp()
    await seedApp(attrs)
    const res = await app.inject({ method: 'POST', url: '/v1/apps', headers: AUTH, payload: attrs })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT')
  })

  it('returns 409 on duplicate subdomain', async () => {
    const first = testApp()
    await seedApp(first)
    const second = { ...testApp(), subdomain: first.subdomain }
    const res = await app.inject({ method: 'POST', url: '/v1/apps', headers: AUTH, payload: second })
    expect(res.statusCode).toBe(409)
  })

  it('returns 422 when required fields are missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/apps', headers: AUTH, payload: { appId: 'x' } })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/apps/:appId
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/apps/:appId', () => {
  it('returns the app by app_id', async () => {
    const created = await seedApp()
    const res = await app.inject({ method: 'GET', url: `/v1/apps/${created.app_id}`, headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).app_id).toBe(created.app_id)
  })

  it('returns 404 for unknown app_id', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/apps/does-not-exist', headers: AUTH })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /v1/apps/:appId/status
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /v1/apps/:appId/status', () => {
  it('suspends an active app', async () => {
    const created = await seedApp()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/apps/${created.app_id}/status`,
      headers: AUTH, payload: { status: 'suspended' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('suspended')
  })

  it('reactivates a suspended app', async () => {
    const created = await seedApp()
    await app.inject({ method: 'PATCH', url: `/v1/apps/${created.app_id}/status`, headers: AUTH, payload: { status: 'suspended' } })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/apps/${created.app_id}/status`,
      headers: AUTH, payload: { status: 'active' },
    })
    expect(JSON.parse(res.body).status).toBe('active')
  })

  it('returns 404 for unknown app_id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/apps/no-such-app/status',
      headers: AUTH, payload: { status: 'suspended' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 422 for invalid status value', async () => {
    const created = await seedApp()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/apps/${created.app_id}/status`,
      headers: AUTH, payload: { status: 'deleted' },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/tenants
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/tenants', () => {
  it('returns all tenants when no appId filter', async () => {
    const seededApp = await seedApp()
    await seedTenant(seededApp.app_id)
    const res = await app.inject({ method: 'GET', url: '/v1/tenants', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('filters tenants by appId query param', async () => {
    const appA = await seedApp()
    const appB = await seedApp()
    await seedTenant(appA.app_id)
    await seedTenant(appB.app_id)

    const res = await app.inject({ method: 'GET', url: `/v1/tenants?appId=${appA.app_id}`, headers: AUTH })
    const body = JSON.parse(res.body)
    expect(body.every((t) => t.app_id === appA.app_id)).toBe(true)
    expect(body.some((t) => t.app_id === appB.app_id)).toBe(false)
  })

  it('returns empty array for appId with no tenants', async () => {
    const seededApp = await seedApp()
    const res = await app.inject({ method: 'GET', url: `/v1/tenants?appId=${seededApp.app_id}`, headers: AUTH })
    expect(JSON.parse(res.body)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /v1/tenants
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /v1/tenants', () => {
  it('creates a tenant under an existing app and returns 201', async () => {
    const seededApp = await seedApp()
    const attrs = testTenant(seededApp.app_id)
    const res = await app.inject({ method: 'POST', url: '/v1/tenants', headers: AUTH, payload: attrs })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.app_id).toBe(seededApp.app_id)
    expect(body.display_name).toBe(attrs.displayName)
    expect(body.subdomain).toBe(attrs.subdomain)
    expect(body.status).toBe('active')
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns 404 when the referenced app does not exist', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tenants', headers: AUTH,
      payload: { appId: 'no-such-app', displayName: 'X', subdomain: `sub-${uuidv4().slice(0, 8)}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 409 on duplicate subdomain', async () => {
    const seededApp = await seedApp()
    const attrs = testTenant(seededApp.app_id)
    await seedTenant(seededApp.app_id, attrs)
    const res = await app.inject({ method: 'POST', url: '/v1/tenants', headers: AUTH, payload: attrs })
    expect(res.statusCode).toBe(409)
  })

  it('returns 422 when required fields are missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tenants', headers: AUTH, payload: { appId: 'x' } })
    expect(res.statusCode).toBe(422)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/tenants/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/tenants/:id', () => {
  it('returns the tenant by id', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({ method: 'GET', url: `/v1/tenants/${tenant.id}`, headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).id).toBe(tenant.id)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/tenants/${uuidv4()}`, headers: AUTH })
    expect(res.statusCode).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /v1/tenants/:id/status
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /v1/tenants/:id/status', () => {
  it('suspends a tenant', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'suspended' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('suspended')
  })

  it('reactivates a suspended tenant', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    await app.inject({ method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`, headers: AUTH, payload: { status: 'suspended' } })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'active' },
    })
    expect(JSON.parse(res.body).status).toBe('active')
  })

  it('returns 404 for unknown tenant id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${uuidv4()}/status`,
      headers: AUTH, payload: { status: 'suspended' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 422 for invalid status', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'deleted' },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 404 handler
// ═════════════════════════════════════════════════════════════════════════════

describe('unknown routes', () => {
  it('returns 404 for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/unknown', headers: AUTH })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND')
  })
})
