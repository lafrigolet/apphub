/**
 * Integration tests for platform/inquiries — require running Postgres.
 *
 * Cubre:
 *   - Migrations aplican (schema + 2 tablas + RLS forzada + policies).
 *   - POST público (sin JWT) crea row + publica event 'inquiry.created'.
 *   - POST sin settings configurado → 422.
 *   - Admin endpoints requieren role owner|admin|staff|super_admin.
 *   - RLS: tenant A no ve inquiries de B.
 *   - PATCH stampea contacted_at / closed_at.
 *
 * Start: ./scripts/test-db-up.sh
 * Run:   pnpm --filter @apphub/platform-inquiries test:integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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

const APP_ID    = 'inq-itest'
const TENANT_A  = '00000000-0000-0000-0000-0000000000e1'
const TENANT_B  = '00000000-0000-0000-0000-0000000000e2'
const INBOX_A   = 'admin-a@itest.local'
const INBOX_B   = 'admin-b@itest.local'

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

// Fake redis para capturar el publish del event.
const publishedEvents = []
const fakeRedis = {
  publish: (channel, data) => {
    publishedEvents.push({ channel, data: JSON.parse(data) })
    return Promise.resolve(1)
  },
}

let app
let adminPool
let modulePool

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool  = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  modulePool = createPool(process.env.DATABASE_URL)
  await adminPool.query('SELECT 1')

  app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler((err, _req, reply) => {
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
  await register({ app, db: modulePool, redis: fakeRedis })
  await app.ready()

  // Seed settings para los dos tenants (precondición para POST público).
  await adminPool.query(`
    INSERT INTO platform_inquiries.settings (app_id, tenant_id, contact_inbox_email)
    VALUES ($1, $2, $3), ($1, $4, $5)
    ON CONFLICT DO NOTHING
  `, [APP_ID, TENANT_A, INBOX_A, TENANT_B, INBOX_B])
})

afterAll(async () => {
  await app?.close()
  await adminPool?.end()
  await modulePool?.end()
})

afterEach(async () => {
  publishedEvents.length = 0
  await adminPool.query(`DELETE FROM platform_inquiries.inquiries WHERE app_id = $1`, [APP_ID])
})

// ═══════════════════════════════════════════════════════════════════
// migrations smoke
// ═══════════════════════════════════════════════════════════════════

describe('migrations', () => {
  it('schema platform_inquiries + 2 tablas existen', async () => {
    const { rows } = await adminPool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'platform_inquiries' ORDER BY tablename`,
    )
    const names = rows.map((r) => r.tablename)
    expect(names).toEqual(expect.arrayContaining(['inquiries', 'settings', 'migrations']))
  })

  it('RLS habilitado + forzado en ambas tablas (deny by default)', async () => {
    const { rows } = await adminPool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'platform_inquiries')
           AND relname IN ('inquiries', 'settings')`,
    )
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true)
      expect(r.relforcerowsecurity).toBe(true)
    }
  })

  it('re-correr migrations es idempotente', async () => {
    await expect(runMigrations(process.env.MIGRATION_DATABASE_URL)).resolves.toBeUndefined()
  })

  it('UNIQUE (reference) bloquea duplicados', async () => {
    const ref = 'INQ-99999999-ABCDEF'
    await adminPool.query(
      `INSERT INTO platform_inquiries.inquiries
         (reference, app_id, tenant_id, contact_name, email, message)
       VALUES ($1, $2, $3, 'A', 'a@x.com', 'm')`,
      [ref, APP_ID, TENANT_A],
    )
    await expect(adminPool.query(
      `INSERT INTO platform_inquiries.inquiries
         (reference, app_id, tenant_id, contact_name, email, message)
       VALUES ($1, $2, $3, 'B', 'b@x.com', 'm')`,
      [ref, APP_ID, TENANT_A],
    )).rejects.toThrow(/duplicate|unique/)
  })
})

// ═══════════════════════════════════════════════════════════════════
// POST /v1/inquiries — público
// ═══════════════════════════════════════════════════════════════════

describe('POST /v1/inquiries — público', () => {
  it('happy: crea row + publica event inquiry.created', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: {
        appId: APP_ID, tenantId: TENANT_A,
        contactName: 'Ana López', email: 'ana@example.com',
        subject: 'Pregunta sobre clases',
        message: '¿Cuándo empiezan las clases para principiantes?',
        source: 'footer-modal',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.data.reference).toMatch(/^INQ-\d{8}-[A-HJ-KM-NP-Z2-9]{6}$/)
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/)

    // DB row verificable via admin pool
    const { rows } = await adminPool.query(
      `SELECT contact_name, email, subject, status FROM platform_inquiries.inquiries WHERE id = $1`,
      [body.data.id],
    )
    expect(rows[0]).toMatchObject({
      contact_name: 'Ana López', email: 'ana@example.com',
      subject: 'Pregunta sobre clases', status: 'new',
    })

    // Event publicado al canal platform.events con payload completo
    expect(publishedEvents).toHaveLength(1)
    expect(publishedEvents[0].channel).toBe('platform.events')
    expect(publishedEvents[0].data.type).toBe('inquiry.created')
    expect(publishedEvents[0].data.payload).toMatchObject({
      appId: APP_ID, tenantId: TENANT_A,
      contactName: 'Ana López', email: 'ana@example.com',
      contactInboxEmail: INBOX_A,
      replyToEmail: INBOX_A,                          // fallback al inbox
      reference: body.data.reference,
    })
  })

  it('sin settings configurado → 422', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: {
        appId: 'unknown-app', tenantId: TENANT_A,
        contactName: 'X', email: 'x@y.com', message: 'hi',
      },
    })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error.message).toContain('contact inbox')
    expect(publishedEvents).toHaveLength(0)
  })

  it('email malformado → 422 zod', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: {
        appId: APP_ID, tenantId: TENANT_A,
        contactName: 'A', email: 'not-an-email', message: 'hi',
      },
    })
    expect(res.statusCode).toBe(422)
  })

  it('contactName vacío → 422 zod', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: {
        appId: APP_ID, tenantId: TENANT_A,
        contactName: '', email: 'a@b.com', message: 'hi',
      },
    })
    expect(res.statusCode).toBe(422)
  })

  it('message > 4000 chars → 422 (anti spam payload)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: {
        appId: APP_ID, tenantId: TENANT_A,
        contactName: 'A', email: 'a@b.com', message: 'x'.repeat(4001),
      },
    })
    expect(res.statusCode).toBe(422)
  })

  it('captura ip + user_agent del request', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      headers: { 'user-agent': 'TestBot/1.0' },
      payload: {
        appId: APP_ID, tenantId: TENANT_A,
        contactName: 'A', email: 'a@b.com', message: 'hi',
      },
    })
    const { rows } = await adminPool.query(
      `SELECT ip::text, user_agent FROM platform_inquiries.inquiries WHERE id = $1`,
      [JSON.parse(res.body).data.id],
    )
    expect(rows[0].user_agent).toBe('TestBot/1.0')
    expect(rows[0].ip).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/)
  })

  it('reference colision → reintento (retry pattern por el caller)', async () => {
    // Crear 2 consultas con el mismo día — chance de colisión es ínfima pero
    // sólo verificamos que el sistema NO produce 2 rows con la misma referencia.
    const r1 = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: { appId: APP_ID, tenantId: TENANT_A, contactName: 'A', email: 'a@b.com', message: 'hi' },
    })
    const r2 = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: { appId: APP_ID, tenantId: TENANT_A, contactName: 'B', email: 'b@b.com', message: 'hi' },
    })
    expect(JSON.parse(r1.body).data.reference).not.toBe(JSON.parse(r2.body).data.reference)
  })
})

// ═══════════════════════════════════════════════════════════════════
// /v1/inquiries/admin — role gate
// ═══════════════════════════════════════════════════════════════════

describe('admin role gate', () => {
  it('sin auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/' })
    expect(res.statusCode).toBe(401)
  })

  it('role user → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/', headers: HDR_USER })
    expect(res.statusCode).toBe(403)
  })

  it('role admin → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/', headers: HDR_ADMIN_A })
    expect(res.statusCode).toBe(200)
  })

  it('role super_admin (platform staff) → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/', headers: HDR_SUPERADMIN_A })
    expect(res.statusCode).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════
// RLS aislamiento entre tenants
// ═══════════════════════════════════════════════════════════════════

describe('RLS isolation', () => {
  async function postFor(tenantId, name) {
    const res = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: { appId: APP_ID, tenantId, contactName: name, email: 'x@y.com', message: 'hi' },
    })
    return JSON.parse(res.body).data
  }

  it('admin del tenant A solo ve inquiries de A en /admin/', async () => {
    const inA = await postFor(TENANT_A, 'A-user')
    const inB = await postFor(TENANT_B, 'B-user')

    const res = await app.inject({ method: 'GET', url: '/v1/inquiries/admin/', headers: HDR_ADMIN_A })
    const ids = JSON.parse(res.body).data.map((i) => i.id)
    expect(ids).toContain(inA.id)
    expect(ids).not.toContain(inB.id)
  })

  it('admin A pide inquiry B por id → 404 (RLS oculta)', async () => {
    const inB = await postFor(TENANT_B, 'B-user')
    const res = await app.inject({
      method: 'GET', url: `/v1/inquiries/admin/${inB.id}`,
      headers: HDR_ADMIN_A,
    })
    expect(res.statusCode).toBe(404)
  })

  it('admin A intenta PATCH inquiry B → 404 (no afecta el row)', async () => {
    const inB = await postFor(TENANT_B, 'B-user')
    const patch = await app.inject({
      method: 'PATCH', url: `/v1/inquiries/admin/${inB.id}`,
      headers: HDR_ADMIN_A, payload: { status: 'contacted' },
    })
    expect(patch.statusCode).toBe(404)
    const { rows } = await adminPool.query(
      `SELECT status FROM platform_inquiries.inquiries WHERE id = $1`, [inB.id],
    )
    expect(rows[0].status).toBe('new')
  })
})

// ═══════════════════════════════════════════════════════════════════
// PATCH FSM + stamp timestamps
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /:id FSM + timestamp stamp', () => {
  let inquiryId

  beforeEach(async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/inquiries/',
      payload: { appId: APP_ID, tenantId: TENANT_A, contactName: 'X', email: 'x@y.com', message: 'hi' },
    })
    inquiryId = JSON.parse(r.body).data.id
  })

  it('new → contacted stampea contacted_at', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/inquiries/admin/${inquiryId}`,
      headers: HDR_ADMIN_A, payload: { status: 'contacted', staffNotes: 'Llamado el 24/05' },
    })
    expect(res.statusCode).toBe(200)
    const { rows } = await adminPool.query(
      `SELECT status, staff_notes, contacted_at, closed_at FROM platform_inquiries.inquiries WHERE id = $1`,
      [inquiryId],
    )
    expect(rows[0].status).toBe('contacted')
    expect(rows[0].staff_notes).toBe('Llamado el 24/05')
    expect(rows[0].contacted_at).not.toBeNull()
    expect(rows[0].closed_at).toBeNull()
  })

  it('new → closed stampea closed_at', async () => {
    await app.inject({
      method: 'PATCH', url: `/v1/inquiries/admin/${inquiryId}`,
      headers: HDR_ADMIN_A, payload: { status: 'closed' },
    })
    const { rows } = await adminPool.query(
      `SELECT status, closed_at FROM platform_inquiries.inquiries WHERE id = $1`, [inquiryId],
    )
    expect(rows[0].status).toBe('closed')
    expect(rows[0].closed_at).not.toBeNull()
  })

  it('closed → contacted → 409 (terminal)', async () => {
    await app.inject({
      method: 'PATCH', url: `/v1/inquiries/admin/${inquiryId}`,
      headers: HDR_ADMIN_A, payload: { status: 'closed' },
    })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/inquiries/admin/${inquiryId}`,
      headers: HDR_ADMIN_A, payload: { status: 'contacted' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('?status=closed filter en list', async () => {
    await app.inject({
      method: 'PATCH', url: `/v1/inquiries/admin/${inquiryId}`,
      headers: HDR_ADMIN_A, payload: { status: 'closed' },
    })
    const newOnly = await app.inject({
      method: 'GET', url: '/v1/inquiries/admin/?status=new', headers: HDR_ADMIN_A,
    })
    const closedOnly = await app.inject({
      method: 'GET', url: '/v1/inquiries/admin/?status=closed', headers: HDR_ADMIN_A,
    })
    expect(JSON.parse(newOnly.body).data.map((i) => i.id)).not.toContain(inquiryId)
    expect(JSON.parse(closedOnly.body).data.map((i) => i.id)).toContain(inquiryId)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Settings endpoints
// ═══════════════════════════════════════════════════════════════════

describe('settings admin', () => {
  it('GET role user → 403', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/inquiries/admin/settings', headers: HDR_USER,
    })
    expect(res.statusCode).toBe(403)
  })

  it('GET role admin → 200 con la row pre-sembrada', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/inquiries/admin/settings', headers: HDR_ADMIN_A,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.contact_inbox_email).toBe(INBOX_A)
  })

  it('PUT actualiza el contact_inbox_email', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/inquiries/admin/settings',
      headers: HDR_ADMIN_A,
      payload: { contactInboxEmail: 'new-inbox@itest.local', replyToEmail: 'replies@itest.local' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.contact_inbox_email).toBe('new-inbox@itest.local')

    // Restaurar para no romper tests siguientes (los settings persisten entre tests)
    await app.inject({
      method: 'PUT', url: '/v1/inquiries/admin/settings',
      headers: HDR_ADMIN_A,
      payload: { contactInboxEmail: INBOX_A },
    })
  })

  it('PUT contactInboxEmail malformado → 422', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/inquiries/admin/settings',
      headers: HDR_ADMIN_A,
      payload: { contactInboxEmail: 'not-an-email' },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/inquiries/health', () => {
  it('200 público', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/inquiries/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', module: 'inquiries' })
  })
})
