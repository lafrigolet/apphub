/**
 * Integration tests for the console login flow.
 *
 * Requires the stack running locally:
 *   docker compose up -d
 *   pnpm --filter @console/console-portal seed
 *
 * Tests hit platform-auth / platform-tenant-config directly on their
 * host-exposed ports (3000 / 3005). The browser request passes through
 * NGINX; we bypass it here because Node's fetch() forbids setting the Host
 * header.
 */
import { describe, it, expect, beforeAll } from 'vitest'

const AUTH    = process.env.VORAGINE_AUTH_URL    ?? 'http://localhost:3000'
const TENANTS = process.env.VORAGINE_TENANTS_URL ?? 'http://localhost:3005'

const SEEDED = {
  staffEmail: 'ana@voragine.local',
  ownerEmail: 'pedro@tiendaana.com',
  adminEmail: 'laura@tiendaana.com',
  password:   'password123',
  tiendaAna:  '10000000-0000-0000-0000-000000000001',
}

async function portalLogin(body) {
  const res = await fetch(`${AUTH}/v1/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json }
}

async function apiGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

beforeAll(async () => {
  try {
    const res = await fetch(`${TENANTS}/v1/tenants/public?appId=console`)
    if (!res.ok) throw new Error(`tenant-config responded ${res.status}`)
  } catch (err) {
    throw new Error(
      `Integration tests require the stack running and seeded.\n` +
      `Start: docker compose up -d && pnpm --filter @console/console-portal seed\n` +
      `Original: ${err.message}`,
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════
// login by email + password (the only call the portal makes)
// ═════════════════════════════════════════════════════════════════════════

describe('login by email+password (portal request shape)', () => {
  it('authenticates a staff user — backend resolves app_id=platform', async () => {
    const { status, body } = await portalLogin({
      email:    SEEDED.staffEmail,
      password: SEEDED.password,
    })
    expect(status).toBe(200)
    expect(body?.data?.role).toBe('super_admin')
    // Decode the JWT to confirm the resolved tenant matches the seeded one
    const payload = JSON.parse(Buffer.from(body.data.accessToken.split('.')[1], 'base64url').toString())
    expect(payload.app_id).toBe('platform')
  })

  it('authenticates a tenant owner — backend resolves app_id=console + matching tenant_id', async () => {
    const { status, body } = await portalLogin({
      email:    SEEDED.ownerEmail,
      password: SEEDED.password,
    })
    expect(status).toBe(200)
    expect(body?.data?.role).toBe('owner')
    const payload = JSON.parse(Buffer.from(body.data.accessToken.split('.')[1], 'base64url').toString())
    expect(payload.app_id).toBe('console')
    expect(payload.tenant_id).toBe(SEEDED.tiendaAna)
  })

  it('authenticates a tenant admin', async () => {
    const { status, body } = await portalLogin({
      email:    SEEDED.adminEmail,
      password: SEEDED.password,
    })
    expect(status).toBe(200)
    expect(body?.data?.role).toBe('admin')
  })

  it('fails with 401 on unknown email', async () => {
    const { status, body } = await portalLogin({
      email:    'does-not-exist@example.com',
      password: SEEDED.password,
    })
    expect(status).toBe(401)
    expect(body?.error?.code).toBe('UNAUTHORIZED')
  })

  it('fails with 401 on wrong password', async () => {
    const { status } = await portalLogin({
      email:    SEEDED.ownerEmail,
      password: 'definitely-not-the-password',
    })
    expect(status).toBe(401)
  })

  it('still supports the legacy appId+tenantId body (backwards compat)', async () => {
    const { status, body } = await portalLogin({
      appId:    'console',
      tenantId: SEEDED.tiendaAna,
      email:    SEEDED.ownerEmail,
      password: SEEDED.password,
    })
    expect(status).toBe(200)
    expect(body?.data?.role).toBe('owner')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Post-login calls the portal makes
// ═════════════════════════════════════════════════════════════════════════

describe('post-login: portal can read its own data', () => {
  it('staff can list all console tenants', async () => {
    const { body } = await portalLogin({ email: SEEDED.staffEmail, password: SEEDED.password })
    const token = body.data.accessToken
    const res = await apiGet(`${TENANTS}/v1/tenants?appId=console`, token)
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(12)
  })

  it('staff can list users inside a tenant (cross-tenant bypass)', async () => {
    const { body } = await portalLogin({ email: SEEDED.staffEmail, password: SEEDED.password })
    const token = body.data.accessToken
    const res = await apiGet(`${AUTH}/v1/users?appId=console&tenantId=${SEEDED.tiendaAna}`, token)
    expect(res.status).toBe(200)
    expect(res.body.some((u) => u.email === SEEDED.ownerEmail)).toBe(true)
  })

  it('tenant owner can load their own tenant (used by AppContext)', async () => {
    const { body } = await portalLogin({ email: SEEDED.ownerEmail, password: SEEDED.password })
    const token = body.data.accessToken
    const res = await apiGet(`${TENANTS}/v1/tenants/${SEEDED.tiendaAna}`, token)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(SEEDED.tiendaAna)
  })

  it('tenant owner can list users in their own tenant', async () => {
    const { body } = await portalLogin({ email: SEEDED.ownerEmail, password: SEEDED.password })
    const token = body.data.accessToken
    const res = await apiGet(`${AUTH}/v1/users?appId=console&tenantId=${SEEDED.tiendaAna}`, token)
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(3)
  })
})
