// La causa raíz del bug "donations 401" se documenta aquí: el contrato
// del guard es que las rutas con `config: { public: true }` pasen sin
// Bearer. Si esto se rompe, esta suite enrojece.
//
// Cubrimos:
//   - public: true bypass
//   - rutas /health, /internal, /docs bypass
//   - 401 sin Bearer / Bearer mal formado / JWT incompleto
//   - 401 token expirado
//   - 403 APP_MISMATCH cuando EXPECTED_APP_ID != token.app_id (excepto
//     platform-* services que aceptan cualquier app)
//   - req.identity poblado con todos los claims
//   - requireRole gate (200 / 403)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'

import { appGuard, requireRole } from '../app-guard.js'

// Helper para fabricar JWT plano (3 partes b64url). NO firmamos —
// app-guard solo decodifica payload, no verifica firma (eso lo hace
// `platform/auth` cuando genera el token; aquí es un payload trust).
function makeToken(payload, { headerOverride } = {}) {
  const header = headerOverride ?? Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig    = 'fake-sig'
  return `${header}.${body}.${sig}`
}

let app
let originalExpectedAppId

beforeEach(async () => {
  originalExpectedAppId = process.env.EXPECTED_APP_ID
  process.env.EXPECTED_APP_ID = 'aulavera'
  app = Fastify({ logger: false })
  await app.register(appGuard)

  app.get('/public', { config: { public: true } }, async () => ({ ok: true }))
  app.get('/private', async (req) => ({ identity: req.identity }))
  app.get('/admin', { preHandler: requireRole('admin', 'super_admin') }, async (req) => ({ role: req.identity.role }))
  app.get('/health',         async () => ({ status: 'ok' }))
  app.get('/internal/sync',  async () => ({ ok: true }))
  app.get('/docs',           async () => ({ ok: true }))
  app.get('/docs/spec',      async () => ({ ok: true }))
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  if (originalExpectedAppId === undefined) delete process.env.EXPECTED_APP_ID
  else process.env.EXPECTED_APP_ID = originalExpectedAppId
})

// ── Bypass paths (no requiere Bearer) ────────────────────────────────

describe('appGuard — paths que omiten el check', () => {
  it('config.public: true → no exige Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/public' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('GET /health bypassea (no exige Bearer)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  it('/internal/* bypassea (loopback machine-to-machine)', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/sync' })
    expect(res.statusCode).toBe(200)
  })

  it('/docs y /docs/* bypassean (OpenAPI público)', async () => {
    expect((await app.inject({ method: 'GET', url: '/docs' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/docs/spec' })).statusCode).toBe(200)
  })
})

// ── Bearer ausente / inválido ─────────────────────────────────────────

describe('appGuard — Authorization header', () => {
  it('401 sin Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/private' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
    expect(res.json().error.message).toMatch(/Missing Authorization/i)
  })

  it("401 si Authorization no empieza por 'Bearer '", async () => {
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: 'Basic abc' } })
    expect(res.statusCode).toBe(401)
  })

  it("401 si token está vacío después de 'Bearer '", async () => {
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: 'Bearer ' } })
    expect(res.statusCode).toBe(401)
  })
})

// ── Payload claims ────────────────────────────────────────────────────

describe('appGuard — claims requeridos', () => {
  it('401 si falta sub', async () => {
    const tok = makeToken({ app_id: 'aulavera', tenant_id: 't1' })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toMatch(/sub/)
  })

  it('401 si falta app_id', async () => {
    const tok = makeToken({ sub: 'u1', tenant_id: 't1' })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toMatch(/app_id/)
  })

  it('401 si falta tenant_id', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera' })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toMatch(/tenant_id/)
  })

  it('401 token expirado', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera', tenant_id: 't1', exp: Math.floor(Date.now() / 1000) - 60 })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toMatch(/expired/i)
  })

  it('401 si el JWT no tiene 3 partes (formato corrupto)', async () => {
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: 'Bearer onlyone' } })
    expect(res.statusCode).toBe(401)
  })

  it('401 si el payload no es JSON válido', async () => {
    const tok = 'h.notbase64ofjson.s'
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(401)
  })
})

// ── app_id matching ───────────────────────────────────────────────────

describe('appGuard — app_id mismatch matrix (regla CLAUDE.md #2)', () => {
  it('JWT app_id=aulavera + EXPECTED=aulavera → OK', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera', tenant_id: 't1', role: 'user', email: 'a@x' })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().identity).toMatchObject({
      userId: 'u1', appId: 'aulavera', tenantId: 't1', role: 'user', email: 'a@x',
    })
  })

  it('JWT app_id=aikikan + EXPECTED=aulavera → 403 APP_MISMATCH', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aikikan', tenant_id: 't1' })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('APP_MISMATCH')
  })

  it('EXPECTED=platform acepta CUALQUIER app_id (los servicios platform-* son cross-app)', async () => {
    process.env.EXPECTED_APP_ID = 'platform'
    // Re-build app con env nuevo.
    await app.close()
    app = Fastify({ logger: false })
    await app.register(appGuard)
    app.get('/private', async (req) => ({ identity: req.identity }))
    app.setErrorHandler((err, _req, reply) => reply.status(err.statusCode ?? 500).send({ error: { code: err.code, message: err.message } }))
    await app.ready()

    for (const appId of ['aulavera', 'aikikan', 'split-pay']) {
      const tok = makeToken({ sub: 'u1', app_id: appId, tenant_id: 't1' })
      const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
      expect(res.statusCode).toBe(200)
      expect(res.json().identity.appId).toBe(appId)
    }
  })
})

// ── identity poblado ──────────────────────────────────────────────────

describe('appGuard — req.identity', () => {
  it('pobla los campos del payload (sub→userId, app_id, tenant_id, role, email); subTenantId reservado→null', async () => {
    const tok = makeToken({
      sub: 'u-1', app_id: 'aulavera', tenant_id: 't-1',
      role: 'admin', email: 'admin@x',
    })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.json().identity).toEqual({
      userId: 'u-1', appId: 'aulavera', tenantId: 't-1',
      subTenantId: null, role: 'admin', email: 'admin@x',
    })
  })

  // Colapso a un tenant por defecto: subTenantId siempre NULL, incluso si un
  // token legacy aún trae sub_tenant_id (se ignora).
  it('subTenantId siempre null (subtenancy reservada), ignora claim legacy', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera', tenant_id: 't1', sub_tenant_id: 'st-legacy' })
    const res = await app.inject({ method: 'GET', url: '/private', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.json().identity.subTenantId).toBeNull()
  })
})

// ── requireRole ───────────────────────────────────────────────────────

describe('requireRole', () => {
  it('200 cuando el role coincide', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera', tenant_id: 't1', role: 'admin' })
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().role).toBe('admin')
  })

  it('403 cuando el role NO está en la lista', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera', tenant_id: 't1', role: 'user' })
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(403)
  })

  it('acepta múltiples roles (admin OR super_admin)', async () => {
    const tok = makeToken({ sub: 'u1', app_id: 'aulavera', tenant_id: 't1', role: 'super_admin' })
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { Authorization: `Bearer ${tok}` } })
    expect(res.statusCode).toBe(200)
  })
})

// ── EXPECTED_APP_ID requerido ─────────────────────────────────────────

describe('appGuard — boot validation', () => {
  it('lanza si EXPECTED_APP_ID no está seteado', async () => {
    delete process.env.EXPECTED_APP_ID
    const f = Fastify({ logger: false })
    await expect(f.register(appGuard).ready()).rejects.toThrow(/EXPECTED_APP_ID/)
    await f.close()
  })
})
