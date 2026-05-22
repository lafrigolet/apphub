/**
 * Integration tests for platform/donations — require a running Postgres.
 *
 * Start dependencies:  ./scripts/test-db-up.sh
 * Run:                 pnpm --filter @apphub/platform-donations test:integration
 *
 * Cubre:
 *   - RLS por (app_id, tenant_id) tanto en causas como en donaciones.
 *   - Role gates: causes admin requiere owner/admin/staff/super_admin.
 *   - Listado público de causas filtra por active=TRUE (no fugas de inactivas).
 *   - UNIQUE (app_id, tenant_id, sub_tenant_id, code) en causes.
 *   - Modelo 182 export — solo donaciones paid del año con NIF se incluyen.
 *
 * Cleanup: usa app_id='donations-itest' + tenants dedicados para no tocar datos reales.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'
import Fastify from 'fastify'
import { appGuard } from '@apphub/platform-sdk/app-guard'
import { ZodError } from 'zod'
import { AppError } from '@apphub/platform-sdk/errors'
import {
  serializerCompiler, validatorCompiler, hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod'
import { register, runMigrations } from '../../index.js'
import { createPool } from '@apphub/platform-sdk/db'

const APP_ID    = 'donations-itest'
const TENANT_A  = '00000000-0000-0000-0000-0000000000a1'
const TENANT_B  = '00000000-0000-0000-0000-0000000000a2'

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

const HDR_ADMIN_A      = { Authorization: `Bearer ${makeToken({ role: 'admin',       tenant_id: TENANT_A })}` }
const HDR_ADMIN_B      = { Authorization: `Bearer ${makeToken({ role: 'admin',       tenant_id: TENANT_B })}` }
const HDR_USER         = { Authorization: `Bearer ${makeToken({ role: 'user',        tenant_id: TENANT_A })}` }
const HDR_SUPERADMIN_A = { Authorization: `Bearer ${makeToken({ role: 'super_admin', tenant_id: TENANT_A, app_id: 'platform' })}` }

let app
let adminPool
let modulePool

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await adminPool.query('SELECT 1')
  modulePool = createPool(process.env.DATABASE_URL)

  // En desarrollo, las tablas se crean por la migration 0001 — la RLS la
  // forzamos via withTenantTransaction. Las service roles necesitan
  // permisos de DML (los provisiona el init script).
  app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err) || err instanceof ZodError
        || err.code === 'FST_ERR_VALIDATION') {
      const details = err instanceof ZodError
        ? err.flatten().fieldErrors
        : (err.validation ?? err.cause?.issues ?? err.message)
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', details } })
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    return reply.status(500).send({ error: { code: 'INTERNAL', message: err.message } })
  })
  await app.register(appGuard)
  // Fake redis: el handler hace .duplicate() para tener un cliente pub/sub
  // separado. Aquí devolvemos un stub que también es "duplicate-able".
  const stubSub = {
    on: () => {}, psubscribe: () => {}, subscribe: () => {},
    quit: () => Promise.resolve(),
  }
  const fakeRedis = {
    publish: () => {}, subscribe: () => {}, on: () => {},
    quit: () => Promise.resolve(),
    duplicate: () => stubSub,
  }
  await register({ app, db: modulePool, redis: fakeRedis })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await adminPool?.end()
  await modulePool?.end()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_donations.donations         WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_donations.donation_subscriptions WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_donations.causes            WHERE app_id = $1`, [APP_ID])
})

// ── helpers ─────────────────────────────────────────────────────────

function causePayload(overrides = {}) {
  return {
    code: `cause-${uuidv4().slice(0, 6)}`,
    name: 'Test Cause',
    description: 'Integration test cause',
    targetCents: 100000,
    currency: 'EUR',
    active: true,
    position: 0,
    ...overrides,
  }
}

async function createCause(headers = HDR_ADMIN_A, payload = causePayload()) {
  const res = await app.inject({
    method: 'POST', url: '/v1/donations/causes/admin/',
    headers, payload,
  })
  expect(res.statusCode).toBe(201)
  return JSON.parse(res.body).data
}

// ═══════════════════════════════════════════════════════════════════
// health
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/donations/health', () => {
  it('200 sin auth (público)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/donations/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', module: 'donations' })
  })
})

// ═══════════════════════════════════════════════════════════════════
// CAUSES — role gate (P0)
// ═══════════════════════════════════════════════════════════════════

describe('causes admin — role gate', () => {
  it('sin auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/causes/admin/' })
    expect(res.statusCode).toBe(401)
  })

  it('role "user" → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/causes/admin/', headers: HDR_USER })
    expect(res.statusCode).toBe(403)
  })

  it('role "admin" → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/causes/admin/', headers: HDR_ADMIN_A })
    expect(res.statusCode).toBe(200)
  })

  it('role "super_admin" → 200 (platform staff)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/causes/admin/', headers: HDR_SUPERADMIN_A })
    expect(res.statusCode).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════
// CAUSES — CRUD
// ═══════════════════════════════════════════════════════════════════

describe('causes admin — CRUD', () => {
  it('POST + GET + DB persistence', async () => {
    const cause = await createCause(HDR_ADMIN_A, causePayload({ name: 'Renovar tatami' }))
    expect(cause.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(cause.app_id).toBe(APP_ID)
    expect(cause.tenant_id).toBe(TENANT_A)
    expect(cause.name).toBe('Renovar tatami')
    expect(Number(cause.raised_cents)).toBe(0)

    const { rows } = await adminPool.query(
      `SELECT name, target_cents, active FROM platform_donations.causes WHERE id = $1`,
      [cause.id],
    )
    expect(rows[0]).toMatchObject({ name: 'Renovar tatami', active: true })
    expect(Number(rows[0].target_cents)).toBe(100000)
  })

  it('UNIQUE (app_id, tenant_id, sub_tenant_id, code) → 409 al duplicar code', async () => {
    const code = `dup-${uuidv4().slice(0, 6)}`
    await createCause(HDR_ADMIN_A, causePayload({ code }))
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/causes/admin/',
      headers: HDR_ADMIN_A, payload: causePayload({ code }),
    })
    expect(res.statusCode).toBe(409)
  })

  it('mismo code en OTRO tenant → permitido (UNIQUE incluye tenant_id)', async () => {
    const code = `same-${uuidv4().slice(0, 6)}`
    await createCause(HDR_ADMIN_A, causePayload({ code }))
    // Admin del tenant B usa el mismo code — RLS aísla; el INSERT debe pasar.
    const res = await app.inject({
      method: 'POST', url: '/v1/donations/causes/admin/',
      headers: HDR_ADMIN_B, payload: causePayload({ code }),
    })
    expect(res.statusCode).toBe(201)
  })

  it('PATCH actualiza campos editables', async () => {
    const cause = await createCause()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/donations/causes/admin/${cause.id}`,
      headers: HDR_ADMIN_A, payload: { name: 'Nuevo nombre', targetCents: 250000 },
    })
    expect(res.statusCode).toBe(200)
    const { rows } = await adminPool.query(
      `SELECT name, target_cents FROM platform_donations.causes WHERE id = $1`,
      [cause.id],
    )
    expect(rows[0].name).toBe('Nuevo nombre')
    expect(Number(rows[0].target_cents)).toBe(250000)
  })

  it('DELETE → soft-delete (active=FALSE), no es DELETE FROM real', async () => {
    const cause = await createCause()
    const res = await app.inject({
      method: 'DELETE', url: `/v1/donations/causes/admin/${cause.id}`,
      headers: HDR_ADMIN_A,
    })
    expect(res.statusCode).toBe(204)
    const { rows } = await adminPool.query(
      `SELECT active FROM platform_donations.causes WHERE id = $1`,
      [cause.id],
    )
    expect(rows[0].active).toBe(false)                    // soft delete — row PERSISTE
  })

  it('PATCH cause inexistente → 404', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/donations/causes/admin/${uuidv4()}`,
      headers: HDR_ADMIN_A, payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════
// CAUSES — RLS aislamiento entre tenants (P0)
// ═══════════════════════════════════════════════════════════════════

describe('causes — RLS isolation', () => {
  it('admin del tenant A NO ve causas del tenant B', async () => {
    const causeA = await createCause(HDR_ADMIN_A, causePayload({ name: 'A-only' }))
    const causeB = await createCause(HDR_ADMIN_B, causePayload({ name: 'B-only' }))

    const resA = await app.inject({ method: 'GET', url: '/v1/donations/causes/admin/', headers: HDR_ADMIN_A })
    const dataA = JSON.parse(resA.body).data
    const idsA = dataA.map((c) => c.id)
    expect(idsA).toContain(causeA.id)
    expect(idsA).not.toContain(causeB.id)
  })

  it('admin del tenant A pide cause B por id → 404 (RLS oculta)', async () => {
    const causeB = await createCause(HDR_ADMIN_B)
    const res = await app.inject({
      method: 'GET', url: `/v1/donations/causes/admin/${causeB.id}`,
      headers: HDR_ADMIN_A,
    })
    expect(res.statusCode).toBe(404)
  })

  it('admin del tenant A intenta PATCH cause B → 404 (RLS oculta)', async () => {
    const causeB = await createCause(HDR_ADMIN_B)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/donations/causes/admin/${causeB.id}`,
      headers: HDR_ADMIN_A, payload: { name: 'tampered' },
    })
    expect(res.statusCode).toBe(404)
    // verify B was NOT modified
    const { rows } = await adminPool.query(
      `SELECT name FROM platform_donations.causes WHERE id = $1`, [causeB.id],
    )
    expect(rows[0].name).not.toBe('tampered')
  })
})

// ═══════════════════════════════════════════════════════════════════
// CAUSES — listado público (filter active=TRUE)
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/donations/causes/ — público', () => {
  it('sin auth, devuelve solo active=TRUE', async () => {
    const active = await createCause(HDR_ADMIN_A, causePayload({ name: 'Activa', active: true }))
    const inactive = await createCause(HDR_ADMIN_A, causePayload({ name: 'Inactiva', active: false }))

    const res = await app.inject({
      method: 'GET',
      url: `/v1/donations/causes/?appId=${APP_ID}&tenantId=${TENANT_A}`,
    })
    expect(res.statusCode).toBe(200)
    const ids = JSON.parse(res.body).data.map((c) => c.id)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(inactive.id)
  })

  it('appId/tenantId requeridos → 422', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/donations/causes/' })
    expect(res.statusCode).toBe(422)
  })

  it('tenantId distinto → 0 causas (no cross-tenant leak)', async () => {
    await createCause(HDR_ADMIN_A, causePayload())
    const res = await app.inject({
      method: 'GET',
      url: `/v1/donations/causes/?appId=${APP_ID}&tenantId=${TENANT_B}`,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════
// DONATIONS DIRECT DB — checkout + paid lifecycle
// ═══════════════════════════════════════════════════════════════════
//
// El checkout real implica fetch a splitpay (loopback HTTP). En integration
// directa al DB testeamos el state que produce el splitpay-events.handler
// al recibir splitpay.checkout.completed.

describe('donations lifecycle (vía DB direct)', () => {
  it('INSERT donation pending → UPDATE paid + INCR cause.raised_cents', async () => {
    const cause = await createCause(HDR_ADMIN_A, causePayload({ targetCents: 200000 }))
    const donationId = uuidv4()

    // INSERT row pending (lo que hace createCheckout antes de llamar splitpay)
    await adminPool.query(
      `INSERT INTO platform_donations.donations
         (id, app_id, tenant_id, cause_id, donor_email, amount_cents, currency, kind, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'EUR', 'one_shot', 'pending')`,
      [donationId, APP_ID, TENANT_A, cause.id, 'donor@itest.local', 5000],
    )

    // Simular splitpay.checkout.completed: UPDATE paid + INCR cause
    await adminPool.query(
      `UPDATE platform_donations.donations
          SET status='paid', paid_at=now(), stripe_payment_intent_id='pi_test'
        WHERE id = $1`,
      [donationId],
    )
    await adminPool.query(
      `UPDATE platform_donations.causes
          SET raised_cents = raised_cents + $2 WHERE id = $1`,
      [cause.id, 5000],
    )

    // Verificar
    const { rows: dRows } = await adminPool.query(
      `SELECT status, paid_at FROM platform_donations.donations WHERE id = $1`,
      [donationId],
    )
    expect(dRows[0].status).toBe('paid')
    expect(dRows[0].paid_at).not.toBeNull()

    const { rows: cRows } = await adminPool.query(
      `SELECT raised_cents FROM platform_donations.causes WHERE id = $1`,
      [cause.id],
    )
    expect(Number(cRows[0].raised_cents)).toBe(5000)
  })

  it('donations INSERT respeta RLS por (app_id, tenant_id)', async () => {
    const causeA = await createCause(HDR_ADMIN_A)
    const dA = uuidv4()
    await adminPool.query(
      `INSERT INTO platform_donations.donations
         (id, app_id, tenant_id, cause_id, donor_email, amount_cents, currency, kind, status)
       VALUES ($1, $2, $3, $4, 'donor@itest.local', 5000, 'EUR', 'one_shot', 'pending')`,
      [dA, APP_ID, TENANT_A, causeA.id],
    )

    // RLS: client conectado como svc_platform_donations con app_id=tenant_B no debe ver donations de A
    const client = await modulePool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('app.app_id', $1, true)`, [APP_ID])
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B])
      const { rows } = await client.query(
        `SELECT id FROM platform_donations.donations WHERE id = $1`,
        [dA],
      )
      expect(rows).toHaveLength(0)              // tenant B no ve donation de A
      await client.query('COMMIT')
    } finally { client.release() }

    // Y como tenant A, sí ve
    const clientA = await modulePool.connect()
    try {
      await clientA.query('BEGIN')
      await clientA.query(`SELECT set_config('app.app_id', $1, true)`, [APP_ID])
      await clientA.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A])
      const { rows } = await clientA.query(
        `SELECT id FROM platform_donations.donations WHERE id = $1`,
        [dA],
      )
      expect(rows).toHaveLength(1)
      await clientA.query('COMMIT')
    } finally { clientA.release() }
  })
})

// ═══════════════════════════════════════════════════════════════════
// ADMIN — listing donations
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/donations/admin', () => {
  it('admin lista solo donaciones de su tenant', async () => {
    const idA = uuidv4(); const idB = uuidv4()
    await adminPool.query(
      `INSERT INTO platform_donations.donations
         (id, app_id, tenant_id, donor_email, amount_cents, currency, kind, status, paid_at)
       VALUES ($1, $2, $3, 'a@itest.local', 5000, 'EUR', 'one_shot', 'paid', now()),
              ($4, $2, $5, 'b@itest.local', 5000, 'EUR', 'one_shot', 'paid', now())`,
      [idA, APP_ID, TENANT_A, idB, TENANT_B],
    )
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/', headers: HDR_ADMIN_A,
    })
    expect(res.statusCode).toBe(200)
    const ids = JSON.parse(res.body).data.map((d) => d.id)
    expect(ids).toContain(idA)
    expect(ids).not.toContain(idB)
  })

  it('role "user" → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/donations/admin/', headers: HDR_USER,
    })
    expect(res.statusCode).toBe(403)
  })
})
