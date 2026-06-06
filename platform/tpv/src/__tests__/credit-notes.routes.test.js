import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/credit-notes.service.js', () => ({
  createCreditNote:    vi.fn(),
  authorizeCreditNote: vi.fn(),
  rejectCreditNote:    vi.fn(),
  listCreditNotes:     vi.fn(),
  getCreditNote:       vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  const roleByToken = { 'cashier-token': 'cashier', 'manager-token': 'manager' }
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        const role = roleByToken[auth.slice(7)] ?? 'user'
        req.identity = {
          userId: 'u1', appId: 'aikikan',
          tenantId: '30000000-0000-0000-0000-000000000001',
          subTenantId: null, role, email: 'x@x',
        }
      })
    }),
    requireRole: (...roles) => async (req, reply) => {
      if (!req.identity?.role || !roles.includes(req.identity.role)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN' } })
      }
    },
  }
})

import { creditNotesRoutes } from '../routes/credit-notes.routes.js'
import * as service from '../services/credit-notes.service.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: new Error('VALIDATION') }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (data) => JSON.stringify(data))
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(creditNotesRoutes, { prefix: '/v1/tpv/credit-notes' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code ?? 'ERROR', message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const RECEIPT = '70000000-0000-0000-0000-000000000001'
const NOTE = '80000000-0000-0000-0000-000000000001'

describe('POST /v1/tpv/credit-notes', () => {
  it('el cajero crea una solicitud de abono (201)', async () => {
    service.createCreditNote.mockResolvedValue({ id: NOTE, status: 'pending', autoAuthorized: false })
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/credit-notes',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { originalReceiptId: RECEIPT, reason: 'producto defectuoso', amountCents: 1100, refundMethod: 'card' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createCreditNote).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'cashier' }),
      expect.objectContaining({ originalReceiptId: RECEIPT, amountCents: 1100 }),
    )
  })

  it('422 sin reason', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/tpv/credit-notes',
      headers: { Authorization: 'Bearer cashier-token' },
      payload: { originalReceiptId: RECEIPT, amountCents: 1100, refundMethod: 'card' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createCreditNote).not.toHaveBeenCalled()
  })
})

describe('POST /v1/tpv/credit-notes/:id/authorize — manager+', () => {
  it('403 para cajero', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/credit-notes/${NOTE}/authorize`,
      headers: { Authorization: 'Bearer cashier-token' },
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(service.authorizeCreditNote).not.toHaveBeenCalled()
  })

  it('200 para manager (pasa sessionId para refund cash)', async () => {
    service.authorizeCreditNote.mockResolvedValue({ id: NOTE, status: 'authorized', num_serie: 'R-000001' })
    const res = await app.inject({
      method: 'POST', url: `/v1/tpv/credit-notes/${NOTE}/authorize`,
      headers: { Authorization: 'Bearer manager-token' },
      payload: { sessionId: '50000000-0000-0000-0000-000000000001' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.authorizeCreditNote).toHaveBeenCalledWith(
      expect.anything(), NOTE,
      expect.objectContaining({ sessionId: '50000000-0000-0000-0000-000000000001' }),
    )
  })
})

describe('POST /v1/tpv/credit-notes/:id/reject — manager+', () => {
  it('403 para cajero, 200 para manager', async () => {
    service.rejectCreditNote.mockResolvedValue({ id: NOTE, status: 'rejected' })
    const r1 = await app.inject({
      method: 'POST', url: `/v1/tpv/credit-notes/${NOTE}/reject`,
      headers: { Authorization: 'Bearer cashier-token' },
    })
    expect(r1.statusCode).toBe(403)
    const r2 = await app.inject({
      method: 'POST', url: `/v1/tpv/credit-notes/${NOTE}/reject`,
      headers: { Authorization: 'Bearer manager-token' },
    })
    expect(r2.statusCode).toBe(200)
  })
})
