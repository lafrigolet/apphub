// inbound-admin.routes — staff inbox, reprocess, inject, GDPR delete and the
// inbound_routes CRUD. Services and repos mocked; appGuard stubbed with a
// configurable role (staff by default) to assert the requireRole gate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const identity = vi.hoisted(() => ({ current: { userId: 'u1', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'staff' } }))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => { req.identity = identity.current })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

vi.mock('../lib/db.js', () => {
  const release = vi.fn()
  return { pool: { connect: vi.fn().mockResolvedValue({ release }) } }
})

const inboundRepo = vi.hoisted(() => ({
  list: vi.fn(), findById: vi.fn(), listAttachments: vi.fn(), deleteBySender: vi.fn(),
}))
vi.mock('../repositories/inbound-emails.repository.js', () => inboundRepo)

const routesRepo = vi.hoisted(() => ({
  listAll: vi.fn(), insert: vi.fn(), update: vi.fn(), remove: vi.fn(),
}))
vi.mock('../repositories/inbound-routes.repository.js', () => routesRepo)

const inboundSvc = vi.hoisted(() => ({ reprocess: vi.fn(), injectInbound: vi.fn() }))
vi.mock('../services/inbound.service.js', () => inboundSvc)

const attSvc = vi.hoisted(() => ({ deleteStoredObjects: vi.fn(), attachmentDownloadUrl: vi.fn() }))
vi.mock('../services/inbound-attachments.service.js', () => attSvc)

import { inboundAdminRoutes } from '../routes/inbound-admin.routes.js'

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
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL' } })
  })
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(inboundAdminRoutes, { prefix: '/v1/notifications/admin' })
  await app.ready()
  return app
}

let app
const UUID = '0b0f6a9e-2c5d-4f4a-9e93-0a4b1f2c3d4e'

beforeEach(async () => {
  vi.clearAllMocks()
  identity.current = { userId: 'u1', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'staff' }
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('role gate', () => {
  it('403 for non-staff roles on every inbound surface', async () => {
    identity.current = { ...identity.current, role: 'user' }
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/inbound' })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /inbound (+/:id)', () => {
  it('lists with filters', async () => {
    inboundRepo.list.mockResolvedValue([{ id: 'e1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/inbound?status=unrouted&limit=10' })
    expect(res.statusCode).toBe(200)
    expect(inboundRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'unrouted', limit: 10 }))
    expect(res.json().data).toEqual([{ id: 'e1' }])
  })
  it('get detail attaches signed download URLs for stored attachments', async () => {
    inboundRepo.findById.mockResolvedValue({ id: UUID })
    inboundRepo.listAttachments.mockResolvedValue([
      { id: 'a1', status: 'stored', object_key: 'k' },
      { id: 'a2', status: 'skipped' },
    ])
    attSvc.attachmentDownloadUrl.mockResolvedValue('https://signed')
    const res = await app.inject({ method: 'GET', url: `/v1/notifications/admin/inbound/${UUID}` })
    expect(res.statusCode).toBe(200)
    const atts = res.json().data.attachments
    expect(atts[0].download_url).toBe('https://signed')
    expect(atts[1].download_url).toBe(null)
  })
  it('404 when the email does not exist', async () => {
    inboundRepo.findById.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: `/v1/notifications/admin/inbound/${UUID}` })
    expect(res.statusCode).toBe(404)
  })
})

describe('reprocess / inject / GDPR delete', () => {
  it('POST /:id/reprocess re-runs the pipeline', async () => {
    inboundSvc.reprocess.mockResolvedValue({ routed: 'lead.email.received' })
    const res = await app.inject({ method: 'POST', url: `/v1/notifications/admin/inbound/${UUID}/reprocess` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ routed: 'lead.email.received' })
  })
  it('POST /inject 201 runs a synthetic email through the pipeline', async () => {
    inboundSvc.injectInbound.mockResolvedValue({ id: 'e9', unrouted: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/admin/inbound/inject',
      payload: { from: 'ana@x.com', to: ['leads@reply.h.com'], text: 'hola' },
    })
    expect(res.statusCode).toBe(201)
    expect(inboundSvc.injectInbound).toHaveBeenCalledWith(expect.objectContaining({ from: 'ana@x.com' }))
  })
  it('inject 422 without from/to', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/admin/inbound/inject', payload: { text: 'x' } })
    expect(res.statusCode).toBe(422)
  })
  it('DELETE /inbound/by-sender erases rows + S3 objects', async () => {
    inboundRepo.deleteBySender.mockResolvedValue({ deleted: 4, objectKeys: [{ bucket: 'b', object_key: 'k' }] })
    attSvc.deleteStoredObjects.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/v1/notifications/admin/inbound/by-sender?email=ana@x.com' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ deleted: 4, objectsDeleted: 1 })
  })
})

describe('inbound-routes CRUD', () => {
  it('POST 201 creates a rule', async () => {
    routesRepo.insert.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/admin/inbound-routes',
      payload: { pattern: 'leads@reply.h.com', targetEvent: 'lead.email.received' },
    })
    expect(res.statusCode).toBe(201)
  })
  it('PATCH 404 on unknown rule', async () => {
    routesRepo.update.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PATCH', url: `/v1/notifications/admin/inbound-routes/${UUID}`, payload: { enabled: false },
    })
    expect(res.statusCode).toBe(404)
  })
  it('DELETE 200 on success', async () => {
    routesRepo.remove.mockResolvedValue(true)
    const res = await app.inject({ method: 'DELETE', url: `/v1/notifications/admin/inbound-routes/${UUID}` })
    expect(res.statusCode).toBe(200)
  })
})
