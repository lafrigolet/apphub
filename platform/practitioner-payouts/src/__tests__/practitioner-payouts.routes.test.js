// practitioner-payouts.routes — delega en el service inyectando ctx desde
// req.identity, 201 al crear, query passthrough, headers de PDF.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/practitioner-payouts.service.js', () => ({
  createRule:      vi.fn(),
  listRules:       vi.fn(),
  createAccrual:   vi.fn(),
  listAccruals:    vi.fn(),
  closePeriod:     vi.fn(),
  markPayoutPaid:  vi.fn(),
  getPayout:       vi.fn(),
  listPayouts:     vi.fn(),
  exportPayoutPdf: vi.fn(),
}))

import { payoutsRoutes } from '../routes/practitioner-payouts.routes.js'
import * as service from '../services/practitioner-payouts.service.js'

const PRAC = '11111111-1111-1111-1111-111111111111'
const PAY  = '22222222-2222-2222-2222-222222222222'

const identity = { appId: 'clinic', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'admin' }

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = { ...identity } })
  await app.register(payoutsRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    if (err.name === 'ZodError' || err.issues) return reply.status(400).send({ error: { code: 'VALIDATION' } })
    return reply.status(500).send({ error: { code: 'INTERNAL', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /rules', () => {
  it('201 + delega createRule con ctx de identity', async () => {
    service.createRule.mockResolvedValue({ id: 'r1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/practitioner-payouts/rules',
      payload: { practitionerId: PRAC, ratePct: 30 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createRule).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'clinic', tenantId: 't1' }),
      expect.objectContaining({ practitionerId: PRAC, ratePct: 30 }),
    )
  })

  it('body inválido → 400/500', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/practitioner-payouts/rules',
      payload: { practitionerId: 'not-uuid', ratePct: 200 },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createRule).not.toHaveBeenCalled()
  })
})

describe('GET /rules', () => {
  it('pasa filtros del query', async () => {
    service.listRules.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/rules?practitionerId=${PRAC}&serviceId=svc1` })
    expect(service.listRules).toHaveBeenCalledWith(expect.anything(), { practitionerId: PRAC, serviceId: 'svc1' })
  })
})

describe('POST /accruals', () => {
  it('201 + delega createAccrual', async () => {
    service.createAccrual.mockResolvedValue({ id: 'a1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/practitioner-payouts/accruals',
      payload: { practitionerId: PRAC, grossCents: 1000, commissionCents: 300 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createAccrual).toHaveBeenCalled()
  })
})

describe('GET /accruals', () => {
  it('pasa filtros from/to/status', async () => {
    service.listAccruals.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/accruals?status=accrued&from=a&to=b&practitionerId=${PRAC}` })
    expect(service.listAccruals).toHaveBeenCalledWith(expect.anything(), { practitionerId: PRAC, status: 'accrued', from: 'a', to: 'b' })
  })
})

describe('POST /payouts/close', () => {
  it('201 + delega closePeriod', async () => {
    service.closePeriod.mockResolvedValue({ id: PAY })
    const res = await app.inject({
      method: 'POST', url: '/v1/practitioner-payouts/payouts/close',
      payload: { practitionerId: PRAC, periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-02-01T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.closePeriod).toHaveBeenCalled()
  })
})

describe('POST /payouts/:id/pay', () => {
  it('delega markPayoutPaid con externalRef', async () => {
    service.markPayoutPaid.mockResolvedValue({ id: PAY, status: 'paid' })
    const res = await app.inject({
      method: 'POST', url: `/v1/practitioner-payouts/payouts/${PAY}/pay`,
      payload: { externalRef: 'ext1' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.markPayoutPaid).toHaveBeenCalledWith(expect.anything(), PAY, 'ext1')
  })

  it('sin body → externalRef undefined', async () => {
    service.markPayoutPaid.mockResolvedValue({ id: PAY })
    await app.inject({ method: 'POST', url: `/v1/practitioner-payouts/payouts/${PAY}/pay` })
    expect(service.markPayoutPaid).toHaveBeenCalledWith(expect.anything(), PAY, undefined)
  })
})

describe('GET /payouts/:id and /payouts', () => {
  it('getPayout delega', async () => {
    service.getPayout.mockResolvedValue({ id: PAY })
    const res = await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/payouts/${PAY}` })
    expect(res.statusCode).toBe(200)
    expect(service.getPayout).toHaveBeenCalledWith(expect.anything(), PAY)
  })

  it('listPayouts pasa filtros', async () => {
    service.listPayouts.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/payouts?status=pending&practitionerId=${PRAC}` })
    expect(service.listPayouts).toHaveBeenCalledWith(expect.anything(), { practitionerId: PRAC, status: 'pending' })
  })
})

describe('GET /payouts/:id/pdf', () => {
  it('responde con headers de PDF y el buffer', async () => {
    service.exportPayoutPdf.mockResolvedValue({ filename: 'payout-abc.pdf', pdf: Buffer.from('PDF') })
    const res = await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/payouts/${PAY}/pdf` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
    expect(res.headers['content-disposition']).toMatch(/payout-abc\.pdf/)
    expect(service.exportPayoutPdf).toHaveBeenCalledWith(expect.anything(), PAY)
  })
})
