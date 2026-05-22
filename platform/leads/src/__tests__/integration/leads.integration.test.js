/**
 * Integration tests for platform/leads — require a running Postgres.
 *
 * Start dependencies:  docker compose up -d postgres
 * Run:                 pnpm --filter @apphub/platform-leads test:integration
 *
 * Leads NO tienen RLS (existen ANTES de que el prospect sea tenant).
 * El test cubre:
 *   - Public POST funciona sin JWT (config.public: true).
 *   - Admin GET/PATCH requieren JWT con role super_admin|staff (else 401/403).
 *   - Round-trip DB: INSERT → SELECT con todos los campos persistidos.
 *   - Status FSM via PATCH.
 *   - Filtros + paginación + ORDER BY del list.
 *   - Cleanup scope: solo borramos rows con SOURCE='int-test' para no
 *     romper datos reales del entorno compartido.
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

const SOURCE = 'int-test'                              // marker para cleanup
const PLATFORM_TENANT = '00000000-0000-0000-0000-000000000000'

function makeToken(overrides = {}) {
  const payload = {
    sub: uuidv4(),
    app_id: 'platform',
    tenant_id: PLATFORM_TENANT,
    role: 'super_admin',
    email: 'staff@apphub.test',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}

const STAFF_TOKEN      = makeToken({ role: 'staff' })
const SUPERADMIN_TOKEN = makeToken({ role: 'super_admin' })
const USER_TOKEN       = makeToken({ role: 'user' })
const ADMIN_TOKEN      = makeToken({ role: 'admin' })       // app admin, NOT platform staff

const HDR_STAFF      = { Authorization: `Bearer ${STAFF_TOKEN}` }
const HDR_SUPERADMIN = { Authorization: `Bearer ${SUPERADMIN_TOKEN}` }
const HDR_USER       = { Authorization: `Bearer ${USER_TOKEN}` }
const HDR_APPADMIN   = { Authorization: `Bearer ${ADMIN_TOKEN}` }

let app
let adminPool
let modulePool

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  modulePool = createPool(process.env.DATABASE_URL)
  await adminPool.query('SELECT 1')

  app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  // Error handler BEFORE register (encapsulation context).
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
  await register({ app, db: modulePool, redis: null, logger: { info() {}, error() {}, warn() {}, debug() {}, child: () => ({ info() {}, error() {}, warn() {}, debug() {} }) } })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await adminPool?.end()
  await modulePool?.end()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_leads.leads WHERE source = $1`, [SOURCE])
})

// ── helpers ─────────────────────────────────────────────────────────

function leadPayload(overrides = {}) {
  return {
    contactName:  `Test Contact ${uuidv4().slice(0, 8)}`,
    email:        `test+${uuidv4().slice(0, 8)}@example.com`,
    businessName: 'Test Business',
    phone:        '+34600000000',
    industry:     'shop',
    message:      'Hello from integration test',
    source:       SOURCE,
    ...overrides,
  }
}

async function postLead(payload = leadPayload()) {
  const res = await app.inject({ method: 'POST', url: '/v1/leads/', payload })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

// ═══════════════════════════════════════════════════════════════════
// health
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/leads/health', () => {
  it('200 + status ok sin auth (público)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', module: 'leads' })
  })
})

// ═══════════════════════════════════════════════════════════════════
// POST /v1/leads — PÚBLICO (sin auth)
// ═══════════════════════════════════════════════════════════════════

describe('POST /v1/leads — público', () => {
  it('crea lead sin token, devuelve 201 + id + status="new"', async () => {
    const { status, body } = await postLead()
    expect(status).toBe(201)
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.data.status).toBe('new')
    expect(body.data.created_at).toBeTypeOf('string')
  })

  it('persiste TODOS los campos en DB (verifiable vía admin pool)', async () => {
    const payload = leadPayload({
      contactName: 'Ana López', email: 'ana@example.com',
      businessName: 'AnaCo', industry: 'restaurant', message: 'Quiero info',
    })
    const { body } = await postLead(payload)
    const { rows } = await adminPool.query(
      `SELECT contact_name, email, business_name, industry, message, source, status FROM platform_leads.leads WHERE id = $1`,
      [body.data.id],
    )
    expect(rows[0]).toMatchObject({
      contact_name: 'Ana López', email: 'ana@example.com',
      business_name: 'AnaCo', industry: 'restaurant',
      message: 'Quiero info', source: SOURCE, status: 'new',
    })
  })

  it('campos opcionales ausentes → NULL en DB', async () => {
    const { body } = await postLead({
      contactName: 'Solo nombre', email: 'minimal@x.com', source: SOURCE,
    })
    const { rows } = await adminPool.query(
      `SELECT business_name, phone, industry, message FROM platform_leads.leads WHERE id = $1`,
      [body.data.id],
    )
    expect(rows[0]).toEqual({
      business_name: null, phone: null, industry: null, message: null,
    })
  })

  it('email malformado → 422 zod', async () => {
    const { status } = await postLead({ ...leadPayload(), email: 'not-an-email' })
    expect(status).toBe(422)
  })

  it('contactName vacío → 422', async () => {
    const { status } = await postLead({ ...leadPayload(), contactName: '' })
    expect(status).toBe(422)
  })

  it('industry fuera de enum → 422', async () => {
    const { status } = await postLead({ ...leadPayload(), industry: 'banana' })
    expect(status).toBe(422)
  })

  it('captura el IP del request (req.ip)', async () => {
    const { body } = await postLead()
    const { rows } = await adminPool.query(
      `SELECT ip::text FROM platform_leads.leads WHERE id = $1`,
      [body.data.id],
    )
    // Fastify .inject usa 127.0.0.1 por default
    expect(rows[0].ip).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/)
  })

  it('message > 4000 chars → 422 (anti spam payload)', async () => {
    const { status } = await postLead({
      ...leadPayload(), message: 'x'.repeat(4001),
    })
    expect(status).toBe(422)
  })
})

// ═══════════════════════════════════════════════════════════════════
// GET /v1/leads/admin — role gate
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/leads/admin — role gate', () => {
  it('sin Authorization → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/' })
    expect(res.statusCode).toBe(401)
  })

  it('JWT con role="user" → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/', headers: HDR_USER })
    expect(res.statusCode).toBe(403)
  })

  it('JWT con role="admin" (tenant admin, NO staff platform) → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/', headers: HDR_APPADMIN })
    expect(res.statusCode).toBe(403)
  })

  it.each([
    ['staff',       HDR_STAFF],
    ['super_admin', HDR_SUPERADMIN],
  ])('JWT con role="%s" → 200', async (_role, hdr) => {
    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/', headers: hdr })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body).data)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// GET /v1/leads/admin — listado + filtros
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/leads/admin — listado', () => {
  it('ORDER BY created_at DESC (más recientes primero)', async () => {
    const { body: l1 } = await postLead({ ...leadPayload(), contactName: 'First' })
    await new Promise((r) => setTimeout(r, 50))
    const { body: l2 } = await postLead({ ...leadPayload(), contactName: 'Second' })

    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/?limit=10', headers: HDR_STAFF })
    const data = JSON.parse(res.body).data
    const idxFirst  = data.findIndex((l) => l.id === l1.data.id)
    const idxSecond = data.findIndex((l) => l.id === l2.data.id)
    expect(idxSecond).toBeLessThan(idxFirst)            // más reciente arriba
  })

  it('filter status: "new" excluye "contacted"', async () => {
    const { body: a } = await postLead()
    const { body: b } = await postLead()
    // marcar b como contacted
    await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${b.data.id}`,
      headers: HDR_STAFF, payload: { status: 'contacted' },
    })

    const res = await app.inject({
      method: 'GET', url: '/v1/leads/admin/?status=new',
      headers: HDR_STAFF,
    })
    const ids = JSON.parse(res.body).data.map((l) => l.id)
    expect(ids).toContain(a.data.id)
    expect(ids).not.toContain(b.data.id)
  })

  it('limit + offset paginan correctamente', async () => {
    // Crear 3 leads en el namespace SOURCE
    await postLead({ ...leadPayload(), contactName: 'L1' })
    await postLead({ ...leadPayload(), contactName: 'L2' })
    await postLead({ ...leadPayload(), contactName: 'L3' })

    const page1 = await app.inject({ method: 'GET', url: '/v1/leads/admin/?limit=2&offset=0', headers: HDR_STAFF })
    const page2 = await app.inject({ method: 'GET', url: '/v1/leads/admin/?limit=2&offset=2', headers: HDR_STAFF })
    const ids1 = JSON.parse(page1.body).data.map((l) => l.id)
    const ids2 = JSON.parse(page2.body).data.map((l) => l.id)
    // Sin overlap (limit pagination correcto)
    const overlap = ids1.filter((id) => ids2.includes(id))
    expect(overlap).toHaveLength(0)
  })

  it('limit > 500 → 422 (cap defensivo)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/leads/admin/?limit=501', headers: HDR_STAFF })
    expect(res.statusCode).toBe(422)
  })
})

// ═══════════════════════════════════════════════════════════════════
// GET /v1/leads/admin/:id
// ═══════════════════════════════════════════════════════════════════

describe('GET /v1/leads/admin/:id', () => {
  it('UUID inexistente → 404', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/leads/admin/${uuidv4()}`,
      headers: HDR_STAFF,
    })
    expect(res.statusCode).toBe(404)
  })

  it('happy: devuelve el lead completo', async () => {
    const { body } = await postLead({ ...leadPayload(), contactName: 'Detail Test' })
    const res = await app.inject({
      method: 'GET', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_STAFF,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.contact_name).toBe('Detail Test')
  })

  it('role user → 403 incluso para un lead que existe', async () => {
    const { body } = await postLead()
    const res = await app.inject({
      method: 'GET', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_USER,
    })
    expect(res.statusCode).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════════════
// PATCH /v1/leads/admin/:id — status FSM
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /v1/leads/admin/:id', () => {
  it('happy: cambia status + staff_notes; persiste en DB', async () => {
    const { body } = await postLead()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_STAFF,
      payload: { status: 'qualified', staffNotes: 'High-value prospect' },
    })
    expect(res.statusCode).toBe(200)

    const { rows } = await adminPool.query(
      `SELECT status, staff_notes FROM platform_leads.leads WHERE id = $1`,
      [body.data.id],
    )
    expect(rows[0]).toEqual({ status: 'qualified', staff_notes: 'High-value prospect' })
  })

  it('staffNotes ausente → preserve actual (COALESCE)', async () => {
    const { body } = await postLead()
    // 1ª PATCH: añade notes
    await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_STAFF, payload: { status: 'contacted', staffNotes: 'Initial note' },
    })
    // 2ª PATCH: solo cambia status, NO toca notes
    await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_STAFF, payload: { status: 'qualified' },
    })
    const { rows } = await adminPool.query(
      `SELECT status, staff_notes FROM platform_leads.leads WHERE id = $1`,
      [body.data.id],
    )
    expect(rows[0]).toEqual({ status: 'qualified', staff_notes: 'Initial note' })
  })

  it('status fuera de enum → 422 (CHECK constraint también lo cogería)', async () => {
    const { body } = await postLead()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_STAFF, payload: { status: 'banana' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('UUID inexistente → 404', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${uuidv4()}`,
      headers: HDR_STAFF, payload: { status: 'contacted' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('role "user" → 403', async () => {
    const { body } = await postLead()
    const res = await app.inject({
      method: 'PATCH', url: `/v1/leads/admin/${body.data.id}`,
      headers: HDR_USER, payload: { status: 'contacted' },
    })
    expect(res.statusCode).toBe(403)
  })
})
