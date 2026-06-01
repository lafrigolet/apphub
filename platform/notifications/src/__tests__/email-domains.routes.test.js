// email-domains.routes — CRUD de dominios remitentes por tenant.
// Cubre los role gates (owner/admin/staff vs staff-only suspend), la
// impersonación staff via query (?appId/?tenantId), delegación al service,
// y el helper sendError (re-lanza errores sin statusCode).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/email-domains.service.js', () => ({
  createForTenant: vi.fn(), listForTenant: vi.fn(), getForTenant: vi.fn(),
  verifyForTenant: vi.fn(), updateDefaultsForTenant: vi.fn(),
  suspendForTenant: vi.fn(), deleteForTenant: vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        const role = auth.slice(7) // token == role
        const subTenantId = req.headers['x-sub-tenant'] ?? null
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId, role }
      })
    }),
    requireRole: () => async () => {},
  }
})

import { emailDomainsRoutes } from '../routes/email-domains.routes.js'
import * as service from '../services/email-domains.service.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(emailDomainsRoutes, { prefix: '/v1/notifications/email-domains' })
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
const user = { Authorization: 'Bearer user', 'Content-Type': 'application/json' }
const staff = { Authorization: 'Bearer staff', 'Content-Type': 'application/json' }
// Para requests sin body (evita FST_ERR_CTP_EMPTY_JSON_BODY).
const ownerNB = { Authorization: 'Bearer owner' }
const userNB = { Authorization: 'Bearer user' }
const base = '/v1/notifications/email-domains'
const id = '11111111-1111-1111-1111-111111111111'

beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST / (create)', () => {
  it('owner crea → 201 + delega', async () => {
    service.createForTenant.mockResolvedValue({ id })
    const res = await app.inject({ method: 'POST', url: `${base}/`, headers: owner, payload: { domain: 'mail.x.com' } })
    expect(res.statusCode).toBe(201)
    expect(service.createForTenant).toHaveBeenCalled()
  })

  it('user normal → 403', async () => {
    const res = await app.inject({ method: 'POST', url: `${base}/`, headers: user, payload: { domain: 'mail.x.com' } })
    expect(res.statusCode).toBe(403)
    expect(service.createForTenant).not.toHaveBeenCalled()
  })

  it('error con statusCode → sendError lo propaga con código', async () => {
    service.createForTenant.mockRejectedValue(Object.assign(new Error('bad'), { statusCode: 422, code: 'INVALID_DOMAIN' }))
    const res = await app.inject({ method: 'POST', url: `${base}/`, headers: owner, payload: { domain: 'mail.x.com' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_DOMAIN')
  })

  it('error sin statusCode → sendError re-lanza (500)', async () => {
    service.createForTenant.mockRejectedValue(new Error('boom'))
    const res = await app.inject({ method: 'POST', url: `${base}/`, headers: owner, payload: { domain: 'mail.x.com' } })
    expect(res.statusCode).toBe(500)
  })
})

describe('GET / y GET /:id', () => {
  it('lista (cualquier rol autenticado)', async () => {
    service.listForTenant.mockResolvedValue([{ id }])
    const res = await app.inject({ method: 'GET', url: `${base}/`, headers: user })
    expect(res.json().data).toEqual([{ id }])
  })

  it('staff puede impersonar via query (?appId/?tenantId)', async () => {
    service.listForTenant.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `${base}/?appId=split-pay&tenantId=t9`, headers: staff })
    expect(service.listForTenant).toHaveBeenCalledWith(expect.objectContaining({ appId: 'split-pay', tenantId: 't9' }))
  })

  it('staff impersona con solo appId → tenantId cae a su propio (rama ??)', async () => {
    service.listForTenant.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `${base}/?appId=split-pay`, headers: staff })
    expect(service.listForTenant).toHaveBeenCalledWith(expect.objectContaining({ appId: 'split-pay', tenantId: 't1' }))
  })

  it('staff sin query usa su propio ctx (no impersona)', async () => {
    service.listForTenant.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `${base}/`, headers: staff })
    expect(service.listForTenant).toHaveBeenCalledWith(expect.objectContaining({ appId: 'aikikan', tenantId: 't1' }))
  })

  it('GET /:id delega', async () => {
    service.getForTenant.mockResolvedValue({ id })
    const res = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: user })
    expect(res.json().data.id).toBe(id)
  })

  it('user con subTenantId → se propaga en el ctx (rama ??)', async () => {
    service.listForTenant.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `${base}/`, headers: { ...user, 'x-sub-tenant': 'st1' } })
    expect(service.listForTenant).toHaveBeenCalledWith(expect.objectContaining({ subTenantId: 'st1' }))
  })
})

describe('verify / patch / suspend / delete', () => {
  it('POST /:id/verify (owner)', async () => {
    service.verifyForTenant.mockResolvedValue({ status: 'verified' })
    const res = await app.inject({ method: 'POST', url: `${base}/${id}/verify`, headers: ownerNB })
    expect(res.statusCode).toBe(200)
  })

  it('POST /:id/verify user → 403', async () => {
    const res = await app.inject({ method: 'POST', url: `${base}/${id}/verify`, headers: userNB })
    expect(res.statusCode).toBe(403)
  })

  it('PATCH /:id (owner) actualiza defaults', async () => {
    service.updateDefaultsForTenant.mockResolvedValue({ id })
    const res = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: owner, payload: { defaultFromName: 'X' } })
    expect(res.statusCode).toBe(200)
  })

  it('POST /:id/suspend solo staff', async () => {
    service.suspendForTenant.mockResolvedValue({ status: 'suspended' })
    const ok = await app.inject({ method: 'POST', url: `${base}/${id}/suspend`, headers: staff, payload: { reason: 'abuse' } })
    expect(ok.statusCode).toBe(200)
    const denied = await app.inject({ method: 'POST', url: `${base}/${id}/suspend`, headers: owner, payload: {} })
    expect(denied.statusCode).toBe(403)
  })

  it('DELETE /:id (owner) → 204', async () => {
    service.deleteForTenant.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `${base}/${id}`, headers: ownerNB })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /:id user → 403', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${base}/${id}`, headers: userNB })
    expect(res.statusCode).toBe(403)
  })
})

describe('sendError en cada verbo (rama catch con statusCode)', () => {
  const appErr = () => Object.assign(new Error('nope'), { statusCode: 404, code: 'NOT_FOUND' })

  it('GET /:id error con statusCode → propaga código', async () => {
    service.getForTenant.mockRejectedValue(appErr())
    const res = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: user })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('POST /:id/verify error con statusCode', async () => {
    service.verifyForTenant.mockRejectedValue(appErr())
    const res = await app.inject({ method: 'POST', url: `${base}/${id}/verify`, headers: ownerNB })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /:id error con statusCode', async () => {
    service.updateDefaultsForTenant.mockRejectedValue(appErr())
    const res = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: owner, payload: { defaultFromName: 'X' } })
    expect(res.statusCode).toBe(404)
  })

  it('POST /:id/suspend error con statusCode', async () => {
    service.suspendForTenant.mockRejectedValue(appErr())
    const res = await app.inject({ method: 'POST', url: `${base}/${id}/suspend`, headers: staff, payload: { reason: 'x' } })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /:id error con statusCode', async () => {
    service.deleteForTenant.mockRejectedValue(appErr())
    const res = await app.inject({ method: 'DELETE', url: `${base}/${id}`, headers: ownerNB })
    expect(res.statusCode).toBe(404)
  })
})

describe('impersonación staff con solo tenantId (rama appId ?? id.appId)', () => {
  it('staff ?tenantId → appId cae a su propio', async () => {
    service.listForTenant.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `${base}/?tenantId=t9`, headers: staff })
    expect(service.listForTenant).toHaveBeenCalledWith(expect.objectContaining({ appId: 'aikikan', tenantId: 't9' }))
  })
})

describe('defaults defensivos (?? {}) — handlers directos', () => {
  // Recorder fake-fastify para invocar los handlers con req.body undefined.
  async function handlers() {
    const routes = []
    const push = (m) => (p, o, h) => routes.push({ m, p, h: h ?? o })
    await emailDomainsRoutes({
      post: push('post'), get: push('get'), patch: push('patch'), delete: push('delete'),
    })
    return routes
  }
  const find = (rs, m, p) => rs.find((r) => r.m === m && r.p === p)
  const identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'owner' }

  it('POST / con body undefined → createBody.parse(req.body ?? {}) → lanza (domain requerido)', async () => {
    const rs = await handlers()
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    await expect(find(rs, 'post', '/').h({ headers: {}, identity }, reply)).rejects.toBeTruthy()
  })

  it('PATCH /:id con body undefined → defaultsBody.parse(req.body ?? {}) → {} → delega', async () => {
    service.updateDefaultsForTenant.mockResolvedValue({ id })
    const rs = await handlers()
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    const out = await find(rs, 'patch', '/:id').h({ headers: {}, identity, params: { id } }, reply)
    expect(out.data).toEqual({ id })
    expect(service.updateDefaultsForTenant).toHaveBeenCalledWith(expect.anything(), id, {})
  })

  it('POST /:id/suspend con body undefined → suspendBody.parse(req.body ?? {}) → {} → reason undefined', async () => {
    service.suspendForTenant.mockResolvedValue({ status: 'suspended' })
    const rs = await handlers()
    const staffId = { ...identity, role: 'staff' }
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    const out = await find(rs, 'post', '/:id/suspend').h({ headers: {}, identity: staffId, params: { id } }, reply)
    expect(out.data).toEqual({ status: 'suspended' })
    expect(service.suspendForTenant).toHaveBeenCalledWith(expect.anything(), id, undefined)
  })
})
