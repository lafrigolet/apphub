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
  listWithholdingSettings: vi.fn(),
  upsertWithholdingSetting: vi.fn(),
  createSchedule:  vi.fn(),
  listSchedules:   vi.fn(),
  getSchedule:     vi.fn(),
  updateSchedule:  vi.fn(),
  deleteSchedule:  vi.fn(),
}))

import { payoutsRoutes } from '../routes/practitioner-payouts.routes.js'
import * as service from '../services/practitioner-payouts.service.js'

const PRAC = '11111111-1111-1111-1111-111111111111'
const PAY  = '22222222-2222-2222-2222-222222222222'

const identity = { appId: 'clinic', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'admin' }

async function buildApp(role = 'admin') {
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
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = { ...identity, role } })
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

describe('role guard (requireRole)', () => {
  it('rol no autorizado → 403 y NO llama al service', async () => {
    const userApp = await buildApp('user')
    const res = await userApp.inject({ method: 'GET', url: '/v1/practitioner-payouts/payouts' })
    expect(res.statusCode).toBe(403)
    expect(service.listPayouts).not.toHaveBeenCalled()
    await userApp.close()
  })

  it('staff autorizado → pasa el guard', async () => {
    const staffApp = await buildApp('staff')
    service.listPayouts.mockResolvedValue([])
    const res = await staffApp.inject({ method: 'GET', url: '/v1/practitioner-payouts/payouts' })
    expect(res.statusCode).toBe(200)
    await staffApp.close()
  })
})

describe('withholding settings endpoints', () => {
  it('GET delega listWithholdingSettings', async () => {
    service.listWithholdingSettings.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/practitioner-payouts/withholding-settings' })
    expect(res.statusCode).toBe(200)
    expect(service.listWithholdingSettings).toHaveBeenCalled()
  })

  it('PUT delega upsertWithholdingSetting (tenant default)', async () => {
    service.upsertWithholdingSetting.mockResolvedValue({ id: 'w1' })
    const res = await app.inject({
      method: 'PUT', url: '/v1/practitioner-payouts/withholding-settings',
      payload: { withholdingPct: 15 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.upsertWithholdingSetting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ withholdingPct: 15 }))
  })

  it('PUT con pct inválido → 400/500', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/practitioner-payouts/withholding-settings',
      payload: { withholdingPct: 200 },
    })
    expect([400, 500]).toContain(res.statusCode)
  })
})

describe('schedules CRUD endpoints', () => {
  const SCH = '33333333-3333-3333-3333-333333333333'

  it('POST → 201 createSchedule', async () => {
    service.createSchedule.mockResolvedValue({ id: SCH })
    const res = await app.inject({
      method: 'POST', url: '/v1/practitioner-payouts/schedules',
      payload: { practitionerId: PRAC, period: 'monthly', nextRunAt: '2026-07-01T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createSchedule).toHaveBeenCalled()
  })

  it('GET lista pasa filtros', async () => {
    service.listSchedules.mockResolvedValue([])
    await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/schedules?practitionerId=${PRAC}&isActive=true` })
    expect(service.listSchedules).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ practitionerId: PRAC, isActive: true }))
  })

  it('GET :id delega getSchedule', async () => {
    service.getSchedule.mockResolvedValue({ id: SCH })
    const res = await app.inject({ method: 'GET', url: `/v1/practitioner-payouts/schedules/${SCH}` })
    expect(res.statusCode).toBe(200)
    expect(service.getSchedule).toHaveBeenCalledWith(expect.anything(), SCH)
  })

  it('PATCH :id delega updateSchedule (pausa)', async () => {
    service.updateSchedule.mockResolvedValue({ id: SCH, is_active: false })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/practitioner-payouts/schedules/${SCH}`,
      payload: { isActive: false },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateSchedule).toHaveBeenCalledWith(expect.anything(), SCH, expect.objectContaining({ isActive: false }))
  })

  it('DELETE :id delega deleteSchedule', async () => {
    service.deleteSchedule.mockResolvedValue({ id: SCH })
    const res = await app.inject({ method: 'DELETE', url: `/v1/practitioner-payouts/schedules/${SCH}` })
    expect(res.statusCode).toBe(200)
    expect(service.deleteSchedule).toHaveBeenCalledWith(expect.anything(), SCH)
  })
})

describe('POST /accruals admite type adjustment + cents negativos', () => {
  it('201 manual adjustment con commission negativo', async () => {
    service.createAccrual.mockResolvedValue({ id: 'adj1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/practitioner-payouts/accruals',
      payload: { practitionerId: PRAC, grossCents: -1000, commissionCents: -300, type: 'adjustment' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createAccrual).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'adjustment', commissionCents: -300 }))
  })
})
