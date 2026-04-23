/**
 * Integration tests for platform/auth users-management endpoints — real Postgres.
 *
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-auth test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { createApp } from '../../app.js'

const APP_ID       = 'int-test-users'
const TENANT_A     = '00000000-0000-0000-0000-000000ff00a0'
const TENANT_B     = '00000000-0000-0000-0000-000000ff00b0'
const PLATFORM_TENANT = '00000000-0000-0000-0000-000000ff00f0'

function makeToken(overrides = {}) {
  const payload = {
    sub: uuidv4(), app_id: APP_ID, tenant_id: TENANT_A,
    role: 'admin', email: 'test@test.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}

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
  // Only wipe rows whose tenant_id was created by this test — never touch seed data.
  await adminPool.query(
    `DELETE FROM platform_auth.users WHERE tenant_id IN ($1, $2, $3)`,
    [TENANT_A, TENANT_B, PLATFORM_TENANT],
  )
})

// ── helpers ───────────────────────────────────────────────────────────────────

async function createRawUser({ appId = APP_ID, tenantId = TENANT_A, email, role = 'user', revokedAt = null } = {}) {
  const id = uuidv4()
  const passwordHash = await bcrypt.hash('Password123!', 4)
  const finalEmail = email ?? `u-${id.slice(0, 8)}@int.test`
  await adminPool.query(
    `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, appId, tenantId, finalEmail, passwordHash, role, revokedAt],
  )
  return { id, appId, tenantId, email: finalEmail, role }
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /v1/users
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /v1/users', () => {
  it('returns 403 when caller has a non-staff role', async () => {
    const token = makeToken({ role: 'user' })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}&tenantId=${TENANT_A}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('staff can list users across tenants (no tenantId provided)', async () => {
    await createRawUser({ tenantId: TENANT_A, email: `a-${uuidv4().slice(0, 6)}@int.test` })
    await createRawUser({ tenantId: TENANT_B, email: `b-${uuidv4().slice(0, 6)}@int.test` })

    const token = makeToken({ role: 'super_admin', app_id: 'platform', tenant_id: PLATFORM_TENANT })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const tenantIds = new Set(body.map((u) => u.tenant_id))
    expect(tenantIds.has(TENANT_A)).toBe(true)
    expect(tenantIds.has(TENANT_B)).toBe(true)
  })

  it('admin can list users in their own tenant', async () => {
    const a = await createRawUser({ tenantId: TENANT_A })
    await createRawUser({ tenantId: TENANT_B })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}&tenantId=${TENANT_A}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.every((u) => u.tenant_id === TENANT_A)).toBe(true)
    expect(body.some((u) => u.id === a.id)).toBe(true)
  })

  it('non-staff admin asking for another tenant is denied', async () => {
    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}&tenantId=${TENANT_B}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('filters by role when specified', async () => {
    const adminUser = await createRawUser({ tenantId: TENANT_A, role: 'admin' })
    await createRawUser({ tenantId: TENANT_A, role: 'user' })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}&tenantId=${TENANT_A}&role=admin`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = JSON.parse(res.body)
    expect(body.every((u) => u.role === 'admin')).toBe(true)
    expect(body.some((u) => u.id === adminUser.id)).toBe(true)
  })

  it('accepts multiple roles as a comma-separated list', async () => {
    await createRawUser({ tenantId: TENANT_A, role: 'admin' })
    await createRawUser({ tenantId: TENANT_A, role: 'owner' })
    await createRawUser({ tenantId: TENANT_A, role: 'user' })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}&tenantId=${TENANT_A}&role=admin,owner`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = JSON.parse(res.body)
    const roles = new Set(body.map((u) => u.role))
    expect(roles.has('user')).toBe(false)
    expect(roles.has('admin') || roles.has('owner')).toBe(true)
  })

  it('does not return revoked users', async () => {
    const revoked = await createRawUser({ tenantId: TENANT_A, revokedAt: new Date() })
    await createRawUser({ tenantId: TENANT_A })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'GET', url: `/v1/users?appId=${APP_ID}&tenantId=${TENANT_A}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const ids = new Set(JSON.parse(res.body).map((u) => u.id))
    expect(ids.has(revoked.id)).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /v1/users/:id/role
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /v1/users/:id/role', () => {
  it('updates the role and returns the updated user', async () => {
    const target = await createRawUser({ tenantId: TENANT_A, role: 'user' })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${target.id}/role`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).role).toBe('admin')
  })

  it('forbids an admin from changing a user in a different tenant', async () => {
    const target = await createRawUser({ tenantId: TENANT_B, role: 'user' })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${target.id}/role`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('staff can change users across tenants', async () => {
    const target = await createRawUser({ tenantId: TENANT_A, role: 'user' })

    const token = makeToken({ role: 'super_admin', app_id: 'platform', tenant_id: PLATFORM_TENANT })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${target.id}/role`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'owner' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).role).toBe('owner')
  })

  it('rejects self-role-change', async () => {
    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const selfId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${selfId}/role`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'owner' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for unknown user id', async () => {
    const token = makeToken({ role: 'super_admin', app_id: 'platform', tenant_id: PLATFORM_TENANT })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${uuidv4()}/role`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /v1/users/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /v1/users/:id', () => {
  it('soft-deletes the user (sets revoked_at) and returns 204', async () => {
    const target = await createRawUser({ tenantId: TENANT_A })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'DELETE', url: `/v1/users/${target.id}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)

    const { rows } = await adminPool.query(
      `SELECT revoked_at FROM platform_auth.users WHERE id = $1`, [target.id],
    )
    expect(rows[0].revoked_at).toBeTruthy()
  })

  it('rejects self-delete', async () => {
    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const selfId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
    const res = await app.inject({
      method: 'DELETE', url: `/v1/users/${selfId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('forbids an admin from deleting a user in a different tenant', async () => {
    const target = await createRawUser({ tenantId: TENANT_B })

    const token = makeToken({ role: 'admin', app_id: APP_ID, tenant_id: TENANT_A })
    const res = await app.inject({
      method: 'DELETE', url: `/v1/users/${target.id}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
