// admin.routes — surface admin de notifications (config Resend/Twilio/Push,
// templates CRUD, locales, preview SMS test). Cubre el role gate
// (super_admin/staff), GET/PATCH config (invalida caches), templates 404,
// 201, 204, y la liberación de client en finally.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

const { release, connect, query } = vi.hoisted(() => ({
  release: vi.fn(), connect: vi.fn(), query: vi.fn(),
}))

vi.mock('../lib/db.js', () => ({ pool: { connect } }))
vi.mock('../repositories/config.repository.js', () => ({
  listConfig: vi.fn(), upsertValue: vi.fn(),
}))
vi.mock('../repositories/templates.repository.js', () => ({
  list: vi.fn(), findById: vi.fn(), insert: vi.fn(), update: vi.fn(), remove: vi.fn(),
}))
vi.mock('../services/template-renderer.js', () => ({ renderString: vi.fn((s) => `R:${s}`) }))
vi.mock('../services/sms.service.js', () => ({
  sendTestSms: vi.fn(), invalidateSmsConfigCache: vi.fn(),
}))
vi.mock('../services/email.service.js', () => ({ invalidateConfigCache: vi.fn() }))
vi.mock('../services/rate-limit.service.js', () => ({ invalidateRateLimitCache: vi.fn() }))
vi.mock('../services/digest.service.js', () => ({ invalidateDigestModeCache: vi.fn() }))
vi.mock('../services/push.service.js', () => ({ invalidatePushConfigCache: vi.fn() }))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        const token = auth.slice(7)
        const role = token === 'staff-token' ? 'staff' : token === 'super-token' ? 'super_admin' : 'user'
        req.identity = { userId: 'u1', appId: 'platform', tenantId: 't1', role }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!roles.includes(req.identity?.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
    },
  }
})

import { adminRoutes } from '../routes/admin.routes.js'
import * as configRepo from '../repositories/config.repository.js'
import * as tmplRepo from '../repositories/templates.repository.js'
import { sendTestSms } from '../services/sms.service.js'

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
  await app.register(adminRoutes, { prefix: '/v1/notifications/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const H = { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' }
beforeEach(async () => {
  vi.clearAllMocks()
  connect.mockResolvedValue({ release, query })
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('role gate', () => {
  it('401 sin bearer', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/notifications/admin/config' })).statusCode).toBe(401)
  })
  it('403 para user', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/config', headers: { Authorization: 'Bearer user-token' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET/PATCH /config', () => {
  it('GET config (staff) y libera client', async () => {
    configRepo.listConfig.mockResolvedValue([{ key: 'sender_email' }])
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/config', headers: H })
    expect(res.statusCode).toBe(200)
    expect(release).toHaveBeenCalled()
  })

  it('PATCH config upsert + invalida caches (incl. dynamic imports)', async () => {
    configRepo.listConfig.mockResolvedValue([])
    const res = await app.inject({
      method: 'PATCH', url: '/v1/notifications/admin/config', headers: H,
      payload: { sender_email: 'a@b.com', sender_name: 'AppHub' },
    })
    expect(res.statusCode).toBe(200)
    expect(configRepo.upsertValue).toHaveBeenCalledTimes(2)
  })

  it('PATCH config vacío → sin upsert', async () => {
    configRepo.listConfig.mockResolvedValue([])
    const res = await app.inject({ method: 'PATCH', url: '/v1/notifications/admin/config', headers: H, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(configRepo.upsertValue).not.toHaveBeenCalled()
  })
})

describe('POST /sms/test', () => {
  it('delega en sendTestSms', async () => {
    sendTestSms.mockResolvedValue({ stub: true })
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/admin/sms/test', headers: H, payload: { to: '+34123456789', body: 'hi' } })
    expect(res.statusCode).toBe(200)
    expect(sendTestSms).toHaveBeenCalledWith('+34123456789', 'hi')
  })
})

describe('templates', () => {
  it('GET /templates lista', async () => {
    tmplRepo.list.mockResolvedValue([{ id: 't1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/templates', headers: H })
    expect(res.json().data).toEqual([{ id: 't1' }])
  })

  it('GET /templates/:id 404', async () => {
    tmplRepo.findById.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/templates/x', headers: H })
    expect(res.statusCode).toBe(404)
  })

  it('GET /templates/:id 200', async () => {
    tmplRepo.findById.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/templates/t1', headers: H })
    expect(res.json().data.id).toBe('t1')
  })

  it('POST /templates 201', async () => {
    tmplRepo.insert.mockResolvedValue({ id: 'new' })
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/admin/templates', headers: H,
      payload: { key: 'welcome', body_text: 'Hola' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /templates 400 sin key/body_text', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/admin/templates', headers: H, payload: { channel: 'email' } })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH /templates/:id 404', async () => {
    tmplRepo.update.mockResolvedValue(null)
    const res = await app.inject({ method: 'PATCH', url: '/v1/notifications/admin/templates/x', headers: H, payload: { subject: 'S' } })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /templates/:id 200', async () => {
    tmplRepo.update.mockResolvedValue({ id: 't1' })
    const res = await app.inject({ method: 'PATCH', url: '/v1/notifications/admin/templates/t1', headers: H, payload: { subject: 'S' } })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /templates/:id 204', async () => {
    tmplRepo.remove.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: '/v1/notifications/admin/templates/t1', headers: { Authorization: 'Bearer staff-token' } })
    expect(res.statusCode).toBe(204)
  })

  it('POST /templates/:id/preview 404', async () => {
    tmplRepo.findById.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/admin/templates/x/preview', headers: H, payload: {} })
    expect(res.statusCode).toBe(404)
  })

  it('POST /templates/:id/preview renderiza', async () => {
    tmplRepo.findById.mockResolvedValue({ subject: 'Hi {{n}}', body_text: 'b', body_html: 'h' })
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/admin/templates/t1/preview', headers: H,
      payload: { vars: { n: 'A' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.subject).toBe('R:Hi {{n}}')
  })

  it('POST /preview sin vars → usa {} (rama default)', async () => {
    tmplRepo.findById.mockResolvedValue({ subject: 's', body_text: 'b', body_html: 'h' })
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/admin/templates/t1/preview', headers: H, payload: {} })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /locales', () => {
  it('lista locales soportados', async () => {
    query.mockResolvedValue({ rows: [{ locale: 'es', label: 'Español', enabled: true }] })
    const res = await app.inject({ method: 'GET', url: '/v1/notifications/admin/locales', headers: H })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].locale).toBe('es')
  })
})

describe('defaults defensivos (?? {}) — handlers directos', () => {
  // Recorder fake-fastify: captura los handlers para invocarlos con
  // req.body undefined y ejercitar la rama `?? {}` que el validador de
  // Fastify normalmente impediría alcanzar.
  async function handlers() {
    const routes = []
    const push = (m) => (p, o, h) => routes.push({ m, p, h: h ?? o })
    await adminRoutes({
      addHook: () => {},
      get:    push('get'),
      patch:  push('patch'),
      post:   push('post'),
      delete: push('delete'),
    })
    return routes
  }
  const find = (rs, m, p) => rs.find((r) => r.m === m && r.p === p)

  beforeEach(() => {
    vi.clearAllMocks()
    connect.mockResolvedValue({ release, query })
  })

  it('PATCH /config con body undefined → configBody.parse(req.body ?? {}) → {} sin upsert', async () => {
    configRepo.listConfig.mockResolvedValue([])
    const rs = await handlers()
    const out = await find(rs, 'patch', '/config').h({ headers: {} })
    expect(out.data).toEqual([])
    expect(configRepo.upsertValue).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })

  it('POST /sms/test con body undefined → smsTestBody.parse(req.body ?? {}) → lanza (to requerido)', async () => {
    const rs = await handlers()
    await expect(find(rs, 'post', '/sms/test').h({ headers: {} })).rejects.toBeTruthy()
  })

  it('POST /templates con body undefined → templateBody.parse(req.body ?? {}) → {} → 400 (key/body_text)', async () => {
    const rs = await handlers()
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    await find(rs, 'post', '/templates').h({ headers: {} }, reply)
    expect(reply.code).toHaveBeenCalledWith(400)
  })

  it('PATCH /templates/:id con body undefined → templateBody.parse(req.body ?? {}) → {} → update', async () => {
    tmplRepo.update.mockResolvedValue({ id: 't1' })
    const rs = await handlers()
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn((x) => x) }
    const out = await find(rs, 'patch', '/templates/:id').h({ headers: {}, params: { id: 't1' } }, reply)
    expect(out.data).toEqual({ id: 't1' })
    expect(tmplRepo.update).toHaveBeenCalledWith(expect.anything(), 't1', {})
  })
})
