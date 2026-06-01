// intake-forms.routes — wiring HTTP → service.
// Valida status codes, delegación con ctxFromRequest(identity), validación zod
// (body inválido no llega al service) y el endpoint de PDF (headers + bytes).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/intake-forms.service.js', () => ({
  createTemplate:      vi.fn(),
  listTemplates:       vi.fn(),
  getTemplate:         vi.fn(),
  publishTemplate:     vi.fn(),
  createSubmission:    vi.fn(),
  getSubmission:       vi.fn(),
  submitAnswers:       vi.fn(),
  reviewSubmission:    vi.fn(),
  exportSubmissionPdf: vi.fn(),
}))

vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req, reply) => {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
        }
        req.identity = { userId: 'u1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'staff' }
      })
    }),
  }
})

import { intakeFormsRoutes } from '../routes/intake-forms.routes.js'
import * as service from '../services/intake-forms.service.js'

const TPL = '11111111-1111-1111-1111-111111111111'
const SUB = '22222222-2222-2222-2222-222222222222'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const { appGuard } = await import('@apphub/platform-sdk/app-guard')
  await app.register(appGuard)
  await app.register(intakeFormsRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
const auth = { authorization: 'Bearer staff-token', 'Content-Type': 'application/json' }
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('auth gate', () => {
  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/intake-forms/templates' })
    expect(res.statusCode).toBe(401)
    expect(service.listTemplates).not.toHaveBeenCalled()
  })
})

describe('templates', () => {
  it('POST /templates → 201 + delega con identity', async () => {
    service.createTemplate.mockResolvedValue({ id: TPL })
    const res = await app.inject({
      method: 'POST', url: '/v1/intake-forms/templates', headers: auth,
      payload: { code: 'C', name: 'N', schema: { fields: [] } },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe(TPL)
    expect(service.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', tenantId: 't1', role: 'staff' }),
      expect.objectContaining({ code: 'C', name: 'N' }),
    )
  })

  it('POST /templates body inválido no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/intake-forms/templates', headers: auth,
      payload: { code: '', name: '' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createTemplate).not.toHaveBeenCalled()
  })

  it('GET /templates pasa onlyPublished=true desde query', async () => {
    service.listTemplates.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/intake-forms/templates?onlyPublished=true', headers: auth })
    expect(service.listTemplates).toHaveBeenCalledWith(expect.anything(), { onlyPublished: true })
  })

  it('GET /templates sin query → onlyPublished false', async () => {
    service.listTemplates.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/intake-forms/templates', headers: auth })
    expect(service.listTemplates).toHaveBeenCalledWith(expect.anything(), { onlyPublished: false })
  })

  it('GET /templates/:id delega', async () => {
    service.getTemplate.mockResolvedValue({ id: TPL })
    const res = await app.inject({ method: 'GET', url: `/v1/intake-forms/templates/${TPL}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getTemplate).toHaveBeenCalledWith(expect.anything(), TPL)
  })

  it('POST /templates/:id/publish delega', async () => {
    service.publishTemplate.mockResolvedValue({ id: TPL, is_published: true })
    const res = await app.inject({ method: 'POST', url: `/v1/intake-forms/templates/${TPL}/publish`, headers: { authorization: 'Bearer staff-token' } })
    expect(res.statusCode).toBe(200)
    expect(service.publishTemplate).toHaveBeenCalledWith(expect.anything(), TPL)
  })
})

describe('submissions', () => {
  it('POST /submissions → 201 + delega', async () => {
    service.createSubmission.mockResolvedValue({ id: SUB })
    const res = await app.inject({
      method: 'POST', url: '/v1/intake-forms/submissions', headers: auth,
      payload: { templateId: TPL },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createSubmission).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ templateId: TPL }))
  })

  it('POST /submissions body inválido (templateId no-uuid) no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/intake-forms/submissions', headers: auth,
      payload: { templateId: 'nope' },
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.createSubmission).not.toHaveBeenCalled()
  })

  it('GET /submissions/:id delega', async () => {
    service.getSubmission.mockResolvedValue({ id: SUB })
    const res = await app.inject({ method: 'GET', url: `/v1/intake-forms/submissions/${SUB}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(service.getSubmission).toHaveBeenCalledWith(expect.anything(), SUB)
  })

  it('POST /submissions/:id/submit delega body', async () => {
    service.submitAnswers.mockResolvedValue({ id: SUB })
    const res = await app.inject({
      method: 'POST', url: `/v1/intake-forms/submissions/${SUB}/submit`, headers: auth,
      payload: { answers: { q1: 'a' } },
    })
    expect(res.statusCode).toBe(200)
    expect(service.submitAnswers).toHaveBeenCalledWith(expect.anything(), SUB, expect.objectContaining({ answers: { q1: 'a' } }))
  })

  it('POST /submissions/:id/submit body inválido no llega al service', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/intake-forms/submissions/${SUB}/submit`, headers: auth,
      payload: {},
    })
    expect([400, 422, 500]).toContain(res.statusCode)
    expect(service.submitAnswers).not.toHaveBeenCalled()
  })

  it('POST /submissions/:id/review delega', async () => {
    service.reviewSubmission.mockResolvedValue({ id: SUB, status: 'reviewed' })
    const res = await app.inject({ method: 'POST', url: `/v1/intake-forms/submissions/${SUB}/review`, headers: { authorization: 'Bearer staff-token' } })
    expect(res.statusCode).toBe(200)
    expect(service.reviewSubmission).toHaveBeenCalledWith(expect.anything(), SUB)
  })
})

describe('pdf', () => {
  it('GET /submissions/:id/pdf → application/pdf + Content-Disposition', async () => {
    service.exportSubmissionPdf.mockResolvedValue({ filename: 'intake-x.pdf', pdf: Buffer.from('%PDF-1.4') })
    const res = await app.inject({ method: 'GET', url: `/v1/intake-forms/submissions/${SUB}/pdf`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="intake-x.pdf"/)
    expect(service.exportSubmissionPdf).toHaveBeenCalledWith(expect.anything(), SUB)
  })
})
