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
  // Remove test data in dependency order
  await adminPool.query(`DELETE FROM platform_tenants.audit_log WHERE app_id LIKE 'int-test-%'`)
  await adminPool.query(`DELETE FROM platform_tenants.tenants  WHERE app_id LIKE 'int-test-%'`)
  await adminPool.query(`DELETE FROM platform_tenants.apps     WHERE app_id LIKE 'int-test-%'`)
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
// PATCH /v1/tenants/:id — update profile fields
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /v1/tenants/:id (profile update)', () => {
  it('updates allowed profile fields and returns the updated tenant', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}`,
      headers: AUTH,
      payload: {
        legalName: 'ACME S.L.',
        cif: 'B12345678',
        country: 'ES',
        contactEmail: 'owner@acme.example',
        plan: 'PRO',
        stripeStatus: 'VERIFIED',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.legal_name).toBe('ACME S.L.')
    expect(body.cif).toBe('B12345678')
    expect(body.country).toBe('ES')
    expect(body.contact_email).toBe('owner@acme.example')
    expect(body.plan).toBe('PRO')
    expect(body.stripe_status).toBe('VERIFIED')
  })

  it('writes an audit entry on successful update', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}`,
      headers: AUTH,
      payload: { legalName: 'New Legal Name' },
    })
    const { rows } = await adminPool.query(
      `SELECT action, detail FROM platform_tenants.audit_log
       WHERE tenant_id = $1 ORDER BY ts DESC LIMIT 5`,
      [tenant.id],
    )
    expect(rows.some((r) => r.action === 'TENANT_UPDATED')).toBe(true)
  })

  it('returns 422 for invalid plan', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}`,
      headers: AUTH, payload: { plan: 'INVALID_PLAN' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 for invalid contactEmail', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}`,
      headers: AUTH, payload: { contactEmail: 'not-an-email' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 404 when the tenant does not exist', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${uuidv4()}`,
      headers: AUTH, payload: { legalName: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH status — archived + reason
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /v1/tenants/:id/status (archive + reason)', () => {
  it('archives a tenant and sets archived_at', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'archived', reason: 'Client offboarded' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('archived')
    expect(body.archived_at).toBeTruthy()
  })

  it('stores the suspend reason on suspend and clears it on reactivate', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)

    const susp = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'suspended', reason: 'Payment failure' },
    })
    expect(JSON.parse(susp.body).suspend_reason).toBe('Payment failure')

    const react = await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'active' },
    })
    expect(JSON.parse(react.body).suspend_reason).toBeNull()
  })

  it('writes a TENANT_SUSPENDED audit entry with the reason as detail', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    await app.inject({
      method: 'PATCH', url: `/v1/tenants/${tenant.id}/status`,
      headers: AUTH, payload: { status: 'suspended', reason: 'Payment failure' },
    })
    const { rows } = await adminPool.query(
      `SELECT action, detail FROM platform_tenants.audit_log
       WHERE tenant_id = $1 AND action = 'TENANT_SUSPENDED'`,
      [tenant.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].detail).toBe('Payment failure')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/audit
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/audit', () => {
  const STAFF_TOKEN = makeToken({ role: 'staff' })
  const STAFF_AUTH  = { Authorization: `Bearer ${STAFF_TOKEN}` }

  it('staff can list audit entries for a specific tenant', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    // The seedTenant call above already produced a TENANT_CREATED audit row
    const res = await app.inject({
      method: 'GET', url: `/v1/audit?tenantId=${tenant.id}`,
      headers: STAFF_AUTH,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((r) => r.action === 'TENANT_CREATED' && r.tenant_id === tenant.id)).toBe(true)
  })

  it('honors the limit query param', async () => {
    const seededApp = await seedApp()
    const tenant = await seedTenant(seededApp.app_id)
    // generate a handful of audit rows
    for (const i of [1, 2, 3, 4]) {
      await app.inject({
        method: 'PATCH', url: `/v1/tenants/${tenant.id}`,
        headers: AUTH, payload: { legalName: `Name ${i}` },
      })
    }
    const res = await app.inject({
      method: 'GET', url: `/v1/audit?tenantId=${tenant.id}&limit=2`,
      headers: STAFF_AUTH,
    })
    expect(JSON.parse(res.body).length).toBe(2)
  })

  it('staff without tenantId sees audit entries across tenants', async () => {
    const seededApp = await seedApp()
    const t1 = await seedTenant(seededApp.app_id)
    const t2 = await seedTenant(seededApp.app_id)
    const res = await app.inject({
      method: 'GET', url: `/v1/audit?appId=${seededApp.app_id}`,
      headers: STAFF_AUTH,
    })
    const ids = new Set(JSON.parse(res.body).map((r) => r.tenant_id))
    expect(ids.has(t1.id)).toBe(true)
    expect(ids.has(t2.id)).toBe(true)
  })

  it('non-staff callers cannot see another tenant audit log', async () => {
    const seededApp = await seedApp()
    const mine  = await seedTenant(seededApp.app_id)
    const other = await seedTenant(seededApp.app_id)

    const nonStaff = makeToken({ role: 'owner', app_id: seededApp.app_id, tenant_id: mine.id })
    const res = await app.inject({
      method: 'GET', url: `/v1/audit?tenantId=${other.id}`,
      headers: { Authorization: `Bearer ${nonStaff}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('non-staff callers have their query auto-scoped to their own tenant', async () => {
    const seededApp = await seedApp()
    const mine = await seedTenant(seededApp.app_id)

    const nonStaff = makeToken({ role: 'owner', app_id: seededApp.app_id, tenant_id: mine.id })
    const res = await app.inject({
      method: 'GET', url: '/v1/audit',
      headers: { Authorization: `Bearer ${nonStaff}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.every((r) => r.tenant_id === mine.id)).toBe(true)
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
