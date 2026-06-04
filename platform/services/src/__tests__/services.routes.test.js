// services.routes — wiring HTTP → service/sessions. Mockeamos ambos servicios
// y montamos el plugin en un Fastify con compiler zod passthrough.
// La identity la inyecta un onRequest hook (en prod la pone appGuard).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/services.service.js', () => ({
  createService:     vi.fn(),
  listServices:      vi.fn(),
  getService:        vi.fn(),
  updateService:     vi.fn(),
  deactivateService: vi.fn(),
  createCategory:    vi.fn(),
  listCategories:    vi.fn(),
  listImages:        vi.fn(),
  attachImage:       vi.fn(),
  detachImage:       vi.fn(),
  listPricingTiers:  vi.fn(),
  addPricingTier:    vi.fn(),
  removePricingTier: vi.fn(),
  quotePrice:        vi.fn(),
  evaluateBookingWindow: vi.fn(),
  listTranslations:  vi.fn(),
  upsertTranslation: vi.fn(),
  removeTranslation: vi.fn(),
}))
vi.mock('../services/service-sessions.service.js', () => ({
  listPublicUpcoming:     vi.fn(),
  createSession:          vi.fn(),
  listSessionsByService:  vi.fn(),
  getSession:             vi.fn(),
  updateSession:          vi.fn(),
  cancelSession:          vi.fn(),
}))

import { servicesRoutes } from '../routes/services.routes.js'
import * as service  from '../services/services.service.js'
import * as sessions from '../services/service-sessions.service.js'

const UUID = '11111111-1111-1111-1111-111111111111'
const SVC  = '22222222-2222-2222-2222-222222222222'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
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
  app.addHook('onRequest', async (req) => {
    req.identity = { appId: 'yoga', tenantId: UUID, subTenantId: null, userId: 'u1', role: 'admin' }
  })
  await app.register(servicesRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const auth = { Authorization: 'Bearer t', 'Content-Type': 'application/json' }
const noBody = { Authorization: 'Bearer t' }

describe('services CRUD', () => {
  it('POST /v1/services → 201 + delega', async () => {
    service.createService.mockResolvedValue({ id: SVC })
    const res = await app.inject({
      method: 'POST', url: '/v1/services', headers: auth,
      payload: { code: 'CONS', name: 'Cons', durationMinutes: 30 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createService).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'yoga', tenantId: UUID }),
      expect.objectContaining({ code: 'CONS' }),
    )
  })

  it('POST /v1/services body inválido → 400/500', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/services', headers: auth, payload: { name: '' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createService).not.toHaveBeenCalled()
  })

  it('GET /v1/services → onlyActive default true', async () => {
    service.listServices.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/services', headers: auth })
    expect(service.listServices).toHaveBeenCalledWith(expect.anything(), { onlyActive: true, category: undefined })
  })

  it('GET /v1/services?onlyActive=false&category=spa', async () => {
    service.listServices.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/services?onlyActive=false&category=spa', headers: auth })
    expect(service.listServices).toHaveBeenCalledWith(expect.anything(), { onlyActive: false, category: 'spa' })
  })

  it('GET /v1/services/:id', async () => {
    service.getService.mockResolvedValue({ id: SVC })
    const res = await app.inject({ method: 'GET', url: `/v1/services/${SVC}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getService).toHaveBeenCalledWith(expect.anything(), SVC)
  })

  it('PATCH /v1/services/:id', async () => {
    service.updateService.mockResolvedValue({ id: SVC, name: 'New' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/services/${SVC}`, headers: auth, payload: { name: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateService).toHaveBeenCalledWith(expect.anything(), SVC, { name: 'New' })
  })

  it('POST /v1/services/:id/deactivate', async () => {
    service.deactivateService.mockResolvedValue({ id: SVC })
    const res = await app.inject({ method: 'POST', url: `/v1/services/${SVC}/deactivate`, headers: noBody })
    expect(res.statusCode).toBe(200)
    expect(service.deactivateService).toHaveBeenCalledWith(expect.anything(), SVC)
  })
})

describe('categories', () => {
  it('POST categories → 201', async () => {
    service.createCategory.mockResolvedValue({ id: 'c1' })
    const res = await app.inject({
      method: 'POST', url: '/v1/services/categories', headers: auth, payload: { name: 'Mains' },
    })
    expect(res.statusCode).toBe(201)
  })
  it('GET categories', async () => {
    service.listCategories.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/services/categories', headers: auth })
    expect(res.statusCode).toBe(200)
  })
})

describe('gallery', () => {
  it('GET images → { data }', async () => {
    service.listImages.mockResolvedValue([{ id: 'i1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/services/${SVC}/images`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'i1' }])
  })
  it('POST images → 201', async () => {
    service.attachImage.mockResolvedValue({ id: 'i1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/services/${SVC}/images`, headers: auth,
      payload: { objectId: UUID, altText: 'a' },
    })
    expect(res.statusCode).toBe(201)
  })
  it('DELETE image → 204', async () => {
    service.detachImage.mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'DELETE', url: `/v1/services/${SVC}/images/${UUID}`, headers: noBody,
    })
    expect(res.statusCode).toBe(204)
    expect(service.detachImage).toHaveBeenCalledWith(expect.anything(), UUID)
  })
})

describe('pricing tiers + quote', () => {
  it('GET tiers → { data }', async () => {
    service.listPricingTiers.mockResolvedValue([{ id: 'pt1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/services/${SVC}/pricing-tiers`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'pt1' }])
  })
  it('POST tier → 201', async () => {
    service.addPricingTier.mockResolvedValue({ id: 'pt1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/services/${SVC}/pricing-tiers`, headers: auth,
      payload: { label: 'peak', priceCents: 2000 },
    })
    expect(res.statusCode).toBe(201)
  })
  it('DELETE tier → 204', async () => {
    service.removePricingTier.mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'DELETE', url: `/v1/services/${SVC}/pricing-tiers/${UUID}`, headers: noBody,
    })
    expect(res.statusCode).toBe(204)
  })
  it('GET quote', async () => {
    service.quotePrice.mockResolvedValue({ priceCents: 1000, tier: null })
    const res = await app.inject({
      method: 'GET', url: `/v1/services/${SVC}/quote?at=2026-05-22T10:00:00Z`, headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(service.quotePrice).toHaveBeenCalledWith(expect.anything(), SVC, '2026-05-22T10:00:00Z')
  })
})

describe('booking window', () => {
  it('GET booking-window → delegates', async () => {
    service.evaluateBookingWindow.mockResolvedValue({ ok: false, reason: 'too_soon' })
    const res = await app.inject({
      method: 'GET', url: `/v1/services/${SVC}/booking-window?at=2026-05-22T10:00:00Z`, headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, reason: 'too_soon' })
    expect(service.evaluateBookingWindow).toHaveBeenCalledWith(expect.anything(), SVC, '2026-05-22T10:00:00Z')
  })

  it('POST service with booking-window fields → forwarded', async () => {
    service.createService.mockResolvedValue({ id: SVC })
    const res = await app.inject({
      method: 'POST', url: '/v1/services', headers: auth,
      payload: { code: 'C', name: 'C', durationMinutes: 30, minAdvanceMinutes: 120, maxAdvanceDays: 30 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minAdvanceMinutes: 120, maxAdvanceDays: 30 }),
    )
  })

  it('POST service with canonical cancellationPolicy → accepted', async () => {
    service.createService.mockResolvedValue({ id: SVC })
    const res = await app.inject({
      method: 'POST', url: '/v1/services', headers: auth,
      payload: {
        code: 'C', name: 'C', durationMinutes: 30,
        cancellationPolicy: { hours_before_cancel: 24, refund_pct: 50, no_show_fee_cents: 1000 },
      },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST service with refund_pct > 100 → 400/500 (schema rejects)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/services', headers: auth,
      payload: { code: 'C', name: 'C', durationMinutes: 30, cancellationPolicy: { refund_pct: 200 } },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.createService).not.toHaveBeenCalled()
  })
})

describe('translations', () => {
  it('GET translations → { data }', async () => {
    service.listTranslations.mockResolvedValue([{ locale: 'es' }])
    const res = await app.inject({ method: 'GET', url: `/v1/services/${SVC}/translations`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ locale: 'es' }])
  })

  it('PUT translation → 201', async () => {
    service.upsertTranslation.mockResolvedValue({ id: 'tr1', locale: 'es' })
    const res = await app.inject({
      method: 'PUT', url: `/v1/services/${SVC}/translations`, headers: auth,
      payload: { locale: 'es', name: 'Consulta', description: 'desc' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.upsertTranslation).toHaveBeenCalledWith(
      expect.anything(), SVC, expect.objectContaining({ locale: 'es', name: 'Consulta' }),
    )
  })

  it('PUT translation with bad locale → 400/500', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/v1/services/${SVC}/translations`, headers: auth,
      payload: { locale: 'not_a_locale!!', name: 'x' },
    })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.upsertTranslation).not.toHaveBeenCalled()
  })

  it('DELETE translation → 204', async () => {
    service.removeTranslation.mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'DELETE', url: `/v1/services/${SVC}/translations/es`, headers: noBody,
    })
    expect(res.statusCode).toBe(204)
    expect(service.removeTranslation).toHaveBeenCalledWith(expect.anything(), SVC, 'es')
  })
})

describe('sessions', () => {
  it('GET /v1/services/sessions/upcoming (público) → { data }', async () => {
    sessions.listPublicUpcoming.mockResolvedValue([{ id: 'ss1' }])
    const res = await app.inject({
      method: 'GET',
      url: `/v1/services/sessions/upcoming?appId=yoga&tenantId=${UUID}&kind=event&limit=10`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ id: 'ss1' }])
    expect(sessions.listPublicUpcoming).toHaveBeenCalledWith(
      { appId: 'yoga', tenantId: UUID }, { kind: 'event', limit: 10, locale: undefined },
    )
  })

  it('GET upcoming with locale → forwarded', async () => {
    sessions.listPublicUpcoming.mockResolvedValue([])
    const res = await app.inject({
      method: 'GET',
      url: `/v1/services/sessions/upcoming?appId=yoga&tenantId=${UUID}&locale=es`,
    })
    expect(res.statusCode).toBe(200)
    expect(sessions.listPublicUpcoming).toHaveBeenCalledWith(
      { appId: 'yoga', tenantId: UUID },
      expect.objectContaining({ locale: 'es' }),
    )
  })

  it('POST /v1/services/:id/sessions → 201', async () => {
    sessions.createSession.mockResolvedValue({ id: 'ss1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/services/${SVC}/sessions`, headers: auth,
      payload: { startsAt: '2026-05-22T10:00:00Z', endsAt: '2026-05-22T11:00:00Z' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('GET /v1/services/:id/sessions → includeCancelled flag', async () => {
    sessions.listSessionsByService.mockResolvedValue([])
    await app.inject({
      method: 'GET', url: `/v1/services/${SVC}/sessions?includeCancelled=true&fromDate=2026-01-01`, headers: auth,
    })
    expect(sessions.listSessionsByService).toHaveBeenCalledWith(
      expect.anything(), SVC, { fromDate: '2026-01-01', includeCancelled: true },
    )
  })

  it('GET session by id', async () => {
    sessions.getSession.mockResolvedValue({ id: 'ss1' })
    const res = await app.inject({ method: 'GET', url: `/v1/services/sessions/${UUID}`, headers: auth })
    expect(res.statusCode).toBe(200)
  })

  it('PATCH session', async () => {
    sessions.updateSession.mockResolvedValue({ id: 'ss1' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/services/sessions/${UUID}`, headers: auth,
      payload: { status: 'completed' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE session (cancel)', async () => {
    sessions.cancelSession.mockResolvedValue({ id: 'ss1', status: 'cancelled' })
    const res = await app.inject({ method: 'DELETE', url: `/v1/services/sessions/${UUID}`, headers: noBody })
    expect(res.statusCode).toBe(200)
  })
})
