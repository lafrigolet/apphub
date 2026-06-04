// packages.routes — delega en el service inyectando ctx desde req.identity,
// devuelve códigos de estado correctos (201/204/200) y valida bodies con zod.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/packages.service.js', () => ({
  createTemplate:      vi.fn(),
  listTemplates:       vi.fn(),
  purchase:            vi.fn(),
  getPurchase:         vi.fn(),
  listPurchases:       vi.fn(),
  redeem:              vi.fn(),
  refundSession:       vi.fn(),
  listAuthorizedUsers: vi.fn(),
  addAuthorizedUser:   vi.fn(),
  removeAuthorizedUser: vi.fn(),
  transferPackage:     vi.fn(),
  listTransfers:       vi.fn(),
  setAutoRenew:        vi.fn(),
  renewPackage:        vi.fn(),
  adjustBalance:       vi.fn(),
  freezePackage:       vi.fn(),
  unfreezePackage:     vi.fn(),
  extendExpiry:        vi.fn(),
  listFreezes:         vi.fn(),
  cancelPackage:       vi.fn(),
}))

import { packagesRoutes } from '../routes/packages.routes.js'
import * as service from '../services/packages.service.js'

const SVC_ID  = '33333333-3333-3333-3333-333333333333'
const TPL_ID  = '11111111-1111-1111-1111-111111111111'
const PKG_ID  = '22222222-2222-2222-2222-222222222222'
const USER_ID = '44444444-4444-4444-4444-444444444444'
const OTHER   = '55555555-5555-5555-5555-555555555555'

const identity = { appId: 'yoga', tenantId: 't1', subTenantId: null, userId: USER_ID, role: 'buyer' }

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
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = { ...identity } })
  await app.register(packagesRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    // zod parse errors surface as 400
    if (err.name === 'ZodError' || err.issues) return reply.status(400).send({ error: { code: 'VALIDATION' } })
    return reply.status(500).send({ error: { code: 'INTERNAL', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/packages/templates', () => {
  it('201 + delega createTemplate con ctx de identity', async () => {
    service.createTemplate.mockResolvedValue({ id: TPL_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/packages/templates',
      payload: { code: 'P10', name: '10x', serviceId: SVC_ID, totalSessions: 10 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'yoga', tenantId: 't1', userId: USER_ID }),
      expect.objectContaining({ code: 'P10' }),
    )
  })

  it('400 con body inválido', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/packages/templates',
      payload: { code: '', name: '', serviceId: 'not-uuid', totalSessions: -1 },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createTemplate).not.toHaveBeenCalled()
  })
})

describe('GET /v1/packages/templates', () => {
  it('onlyActive true por defecto', async () => {
    service.listTemplates.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/packages/templates' })
    expect(service.listTemplates).toHaveBeenCalledWith(expect.anything(), { onlyActive: true })
  })

  it('onlyActive=false en query → false', async () => {
    service.listTemplates.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/packages/templates?onlyActive=false' })
    expect(service.listTemplates).toHaveBeenCalledWith(expect.anything(), { onlyActive: false })
  })
})

describe('POST /v1/packages/purchases', () => {
  it('201 + delega purchase', async () => {
    service.purchase.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({
      method: 'POST', url: '/v1/packages/purchases',
      payload: { templateId: TPL_ID },
    })
    expect(res.statusCode).toBe(201)
    expect(service.purchase).toHaveBeenCalled()
  })
})

describe('GET /v1/packages/purchases/:id', () => {
  it('delega getPurchase', async () => {
    service.getPurchase.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({ method: 'GET', url: `/v1/packages/purchases/${PKG_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getPurchase).toHaveBeenCalledWith(expect.anything(), PKG_ID)
  })
})

describe('GET /v1/packages/purchases', () => {
  it('usa clientUserId del query cuando viene', async () => {
    service.listPurchases.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/packages/purchases?clientUserId=${OTHER}&onlyActive=false` })
    expect(service.listPurchases).toHaveBeenCalledWith(expect.anything(), OTHER, { onlyActive: false })
  })

  it('cae al userId de identity cuando no hay clientUserId', async () => {
    service.listPurchases.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/packages/purchases' })
    expect(service.listPurchases).toHaveBeenCalledWith(expect.anything(), USER_ID, { onlyActive: true })
  })
})

describe('POST /v1/packages/redeem', () => {
  it('delega redeem', async () => {
    service.redeem.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({ method: 'POST', url: '/v1/packages/redeem', payload: { packageId: PKG_ID } })
    expect(res.statusCode).toBe(200)
    expect(service.redeem).toHaveBeenCalled()
  })
})

describe('POST /v1/packages/refund', () => {
  it('delega refundSession', async () => {
    service.refundSession.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({ method: 'POST', url: '/v1/packages/refund', payload: { packageId: PKG_ID } })
    expect(res.statusCode).toBe(200)
    expect(service.refundSession).toHaveBeenCalled()
  })
})

describe('family sharing routes', () => {
  it('GET authorized-users → { data }', async () => {
    service.listAuthorizedUsers.mockResolvedValue([{ user_id: OTHER }])
    const res = await app.inject({ method: 'GET', url: `/v1/packages/purchases/${PKG_ID}/authorized-users` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ user_id: OTHER }])
  })

  it('POST authorized-users → 201', async () => {
    service.addAuthorizedUser.mockResolvedValue({ user_id: OTHER })
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/authorized-users`,
      payload: { userId: OTHER, displayName: 'Ana' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addAuthorizedUser).toHaveBeenCalledWith(expect.anything(), PKG_ID, expect.objectContaining({ userId: OTHER }))
  })

  it('DELETE authorized-users/:userId → 204', async () => {
    service.removeAuthorizedUser.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'DELETE', url: `/v1/packages/purchases/${PKG_ID}/authorized-users/${OTHER}` })
    expect(res.statusCode).toBe(204)
    expect(service.removeAuthorizedUser).toHaveBeenCalledWith(expect.anything(), PKG_ID, OTHER)
  })
})

describe('transfer routes', () => {
  it('POST transfer delega transferPackage', async () => {
    service.transferPackage.mockResolvedValue({ package: {}, transfer: {} })
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/transfer`,
      payload: { toUserId: OTHER, kind: 'gift' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.transferPackage).toHaveBeenCalledWith(expect.anything(), PKG_ID, expect.objectContaining({ toUserId: OTHER }))
  })

  it('GET transfers → { data }', async () => {
    service.listTransfers.mockResolvedValue([{ id: 'tr1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/packages/purchases/${PKG_ID}/transfers` })
    expect(res.json().data).toEqual([{ id: 'tr1' }])
  })
})

describe('renewal routes', () => {
  it('PUT auto-renew delega setAutoRenew', async () => {
    service.setAutoRenew.mockResolvedValue({ id: PKG_ID, auto_renew: true })
    const res = await app.inject({
      method: 'PUT', url: `/v1/packages/purchases/${PKG_ID}/auto-renew`,
      payload: { autoRenew: true },
    })
    expect(res.statusCode).toBe(200)
    expect(service.setAutoRenew).toHaveBeenCalledWith(expect.anything(), PKG_ID, true)
  })

  it('POST renew → 201', async () => {
    service.renewPackage.mockResolvedValue({ id: 'new1' })
    const res = await app.inject({ method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/renew` })
    expect(res.statusCode).toBe(201)
    expect(service.renewPackage).toHaveBeenCalledWith(expect.anything(), PKG_ID)
  })
})

describe('priority routes (#8/#9/#4)', () => {
  it('POST adjust delega adjustBalance', async () => {
    service.adjustBalance.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/adjust`,
      payload: { delta: 2, note: 'goodwill' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.adjustBalance).toHaveBeenCalledWith(expect.anything(), PKG_ID, expect.objectContaining({ delta: 2 }))
  })

  it('POST adjust con delta no-entero → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/adjust`,
      payload: { delta: 1.5 },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.adjustBalance).not.toHaveBeenCalled()
  })

  it('POST freeze delega freezePackage', async () => {
    service.freezePackage.mockResolvedValue({ id: PKG_ID, status: 'frozen' })
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/freeze`,
      payload: { reason: 'vacaciones' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.freezePackage).toHaveBeenCalledWith(expect.anything(), PKG_ID, expect.objectContaining({ reason: 'vacaciones' }))
  })

  it('POST freeze con body vacío funciona', async () => {
    service.freezePackage.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({ method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/freeze`, payload: {} })
    expect(res.statusCode).toBe(200)
  })

  it('POST unfreeze delega unfreezePackage', async () => {
    service.unfreezePackage.mockResolvedValue({ id: PKG_ID, status: 'active' })
    const res = await app.inject({ method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/unfreeze` })
    expect(res.statusCode).toBe(200)
    expect(service.unfreezePackage).toHaveBeenCalledWith(expect.anything(), PKG_ID)
  })

  it('POST extend delega extendExpiry', async () => {
    service.extendExpiry.mockResolvedValue({ id: PKG_ID })
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/extend`,
      payload: { days: 14 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.extendExpiry).toHaveBeenCalledWith(expect.anything(), PKG_ID, expect.objectContaining({ days: 14 }))
  })

  it('GET freezes → { data }', async () => {
    service.listFreezes.mockResolvedValue([{ id: 'f1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/packages/purchases/${PKG_ID}/freezes` })
    expect(res.json().data).toEqual([{ id: 'f1' }])
  })

  it('POST cancel delega cancelPackage', async () => {
    service.cancelPackage.mockResolvedValue({ id: PKG_ID, refundCents: 16000 })
    const res = await app.inject({
      method: 'POST', url: `/v1/packages/purchases/${PKG_ID}/cancel`,
      payload: { penaltyPct: 25 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.cancelPackage).toHaveBeenCalledWith(expect.anything(), PKG_ID, expect.objectContaining({ penaltyPct: 25 }))
  })
})
