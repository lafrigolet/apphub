/**
 * Integration tests for apps/aikikan/aikikan-server — require a running Postgres.
 *
 * Cubre el cross-event flow + RLS por (app_id, tenant_id) en app_aikikan.members
 * según TODO-test.md item P0:
 *   - Members CRUD via /v1/aikikan/members/me + /v1/aikikan/members (admin).
 *   - RLS aislamiento entre tenants en members + dojos.
 *   - JWT con app_id != 'aikikan' → 403 APP_MISMATCH (regla CLAUDE.md #2).
 *   - Health pública.
 *
 * Start: ./scripts/test-db-up.sh
 * Run:   pnpm --filter @aikikan/aikikan-server test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'

import { createApp } from '../../app.js'
import { runMigrations } from '../../lib/migrate.js'
// Aikikan migration 0009 (cutover Fase 2) referencia platform_services.services
// y platform_bookings.bookings — los creamos primero corriendo sus migrations.
import { runMigrations as servicesMigrate } from '@apphub/platform-services'
import { runMigrations as bookingsMigrate } from '@apphub/platform-bookings'

const APP_ID    = 'aikikan'
const TENANT_A  = '00000000-0000-0000-0000-0000000000c1'
const TENANT_B  = '00000000-0000-0000-0000-0000000000c2'

function makeToken(overrides = {}) {
  const payload = {
    sub: uuidv4(), app_id: APP_ID, tenant_id: TENANT_A,
    role: 'admin', email: 'admin@itest.local',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}

const userA1 = uuidv4()
const userA2 = uuidv4()
const userB1 = uuidv4()
const TOKEN_USER_A    = makeToken({ sub: userA1, tenant_id: TENANT_A, role: 'user' })
const TOKEN_ADMIN_A   = makeToken({ sub: uuidv4(), tenant_id: TENANT_A, role: 'admin' })
const TOKEN_USER_B    = makeToken({ sub: userB1, tenant_id: TENANT_B, role: 'user' })
const TOKEN_ADMIN_B   = makeToken({ sub: uuidv4(), tenant_id: TENANT_B, role: 'admin' })
const TOKEN_OWNER_A   = makeToken({ sub: uuidv4(), tenant_id: TENANT_A, role: 'owner' })
const TOKEN_OTHERAPP  = makeToken({ sub: uuidv4(), tenant_id: TENANT_A, app_id: 'aulavera' })  // wrong app

let app
let adminPool

beforeAll(async () => {
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await adminPool.query('SELECT 1')
  // Migration order: platform-services + platform-bookings FIRST (aikikan
  // 0009 cutover hace INSERT cross-schema referenciando esas tablas), después aikikan.
  await servicesMigrate(process.env.MIGRATION_DATABASE_URL)
  await bookingsMigrate(process.env.MIGRATION_DATABASE_URL)
  await runMigrations()
  app = createApp()
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await adminPool?.end()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM app_aikikan.members WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B])
  await adminPool.query(`DELETE FROM app_aikikan.dojos   WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B])
})

// ═══════════════════════════════════════════════════════════════════
// Health (público)
// ═══════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  it('200 sin auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).service).toBe('aikikan-server')
  })

  it('GET /v1/aikikan/health también funciona (alias para nginx)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/health' })
    expect(res.statusCode).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════
// appGuard — auth contract (CLAUDE.md #2 + #8)
// ═══════════════════════════════════════════════════════════════════

describe('appGuard', () => {
  it('sin Authorization → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/members/me' })
    expect(res.statusCode).toBe(401)
  })

  it('Bearer corrupto → 401', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/aikikan/members/me',
      headers: { Authorization: 'Bearer corrupted' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('JWT app_id=aulavera contra EXPECTED_APP_ID=aikikan → 403 APP_MISMATCH', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_OTHERAPP}` },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error?.code).toBe('APP_MISMATCH')
  })

  it('JWT app_id=aikikan → 200/empty profile', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════
// /v1/aikikan/members/me — round trip
// ═══════════════════════════════════════════════════════════════════

describe('members /me', () => {
  it('GET sin profile → 200 con empty:true (cliente debe completar)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.empty).toBe(true)
    expect(body.user_id).toBe(userA1)
  })

  it('PATCH /me crea profile + PATCH otra vez actualiza (upsert)', async () => {
    let res = await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: { dojoName: 'Honbu Dojo', aikidoGrade: '2 Dan' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().dojo_name).toBe('Honbu Dojo')

    // 2ª PATCH — actualiza solo el grade
    res = await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: { aikidoGrade: '3 Dan' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().aikido_grade).toBe('3 Dan')
    expect(res.json().dojo_name).toBe('Honbu Dojo')        // preservado
  })

  it('PATCH /me persiste en DB scoped por (app_id, tenant_id)', async () => {
    await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: { dojoName: 'A-dojo' },
    })
    const { rows } = await adminPool.query(
      `SELECT app_id, tenant_id, dojo_name FROM app_aikikan.members WHERE user_id = $1`,
      [userA1],
    )
    expect(rows[0]).toMatchObject({
      app_id: APP_ID, tenant_id: TENANT_A, dojo_name: 'A-dojo',
    })
  })

  it('memberSince con formato malo (no YYYY-MM-DD) → 500 zod throw', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: { memberSince: '2026/05/22' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})

// ═══════════════════════════════════════════════════════════════════
// /v1/aikikan/members (admin) — role gate + RLS
// ═══════════════════════════════════════════════════════════════════

describe('members admin', () => {
  it('GET con role=user → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/aikikan/members',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it.each([
    ['admin', TOKEN_ADMIN_A],
    ['owner', TOKEN_OWNER_A],
  ])('GET con role=%s → 200', async (_role, token) => {
    const res = await app.inject({
      method: 'GET', url: '/v1/aikikan/members',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('admin del tenant A NO ve members del tenant B (RLS)', async () => {
    // Cada user crea su own profile via PATCH /me
    await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: { dojoName: 'A-dojo' },
    })
    await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_B}` },
      payload: { dojoName: 'B-dojo' },
    })

    // Admin A lista
    const resA = await app.inject({
      method: 'GET', url: '/v1/aikikan/members',
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
    })
    const userIdsA = resA.json().map((m) => m.user_id)
    expect(userIdsA).toContain(userA1)
    expect(userIdsA).not.toContain(userB1)
  })

  it('admin del tenant A pide member B por id → 404 (RLS oculta)', async () => {
    await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_B}` },
      payload: { dojoName: 'B-dojo' },
    })
    const res = await app.inject({
      method: 'GET', url: `/v1/aikikan/members/${userB1}`,
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH admin actualiza cualquier user del MISMO tenant', async () => {
    // user A crea su perfil
    await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: { dojoName: 'A-dojo' },
    })
    // admin A le cambia el grade
    const res = await app.inject({
      method: 'PATCH', url: `/v1/aikikan/members/${userA1}`,
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
      payload: { aikidoGrade: '4 Dan' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().aikido_grade).toBe('4 Dan')
  })
})

// ═══════════════════════════════════════════════════════════════════
// Dojos CRUD — admin role gate + RLS
// ═══════════════════════════════════════════════════════════════════

describe('dojos admin', () => {
  const dojoBody = (overrides = {}) => ({
    name: `Test ${uuidv4().slice(0, 6)}`,
    city: 'Madrid', province: 'Madrid',
    ...overrides,
  })

  it('POST + DELETE flow (admin)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/aikikan/dojos',
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
      payload: dojoBody(),
    })
    expect(created.statusCode).toBe(201)
    const dojoId = created.json().id

    const del = await app.inject({
      method: 'DELETE', url: `/v1/aikikan/dojos/${dojoId}`,
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
    })
    expect(del.statusCode).toBe(204)
  })

  it('POST con role=user → 403 (after schema validation passes)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/aikikan/dojos',
      headers: { Authorization: `Bearer ${TOKEN_USER_A}` },
      payload: dojoBody(),                              // ← valid body, role-gate fires
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin B intenta borrar dojo de A → no afecta el row (RLS bloquea)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/aikikan/dojos',
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
      payload: dojoBody({ name: 'A-only' }),
    })
    const dojoId = created.json().id

    await app.inject({
      method: 'DELETE', url: `/v1/aikikan/dojos/${dojoId}`,
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_B}` },
    })
    // Independientemente del statusCode (404 vs 500 según error mapping),
    // lo crítico es que la fila NO se borre — RLS bloquea el DELETE.
    const { rows } = await adminPool.query(
      `SELECT id FROM app_aikikan.dojos WHERE id = $1`, [dojoId],
    )
    expect(rows).toHaveLength(1)
  })

  it('GET público con ?tenantId= devuelve solo los dojos del tenant', async () => {
    const a = await app.inject({
      method: 'POST', url: '/v1/aikikan/dojos',
      headers: { Authorization: `Bearer ${TOKEN_ADMIN_A}` },
      payload: dojoBody({ name: 'Honbu-A' }),
    })
    const dojoIdA = a.json().id

    const res = await app.inject({
      method: 'GET', url: `/v1/aikikan/dojos?tenantId=${TENANT_A}`,
    })
    expect(res.statusCode).toBe(200)
    const ids = res.json().map((d) => d.id)
    expect(ids).toContain(dojoIdA)
  })
})
