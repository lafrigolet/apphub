// reviews.routes — HTTP surface. Asserts delegation with ctx from req.identity
// (incl. jwt forwarding), status codes (201/204/200), query/param/body
// forwarding, vote value mapping and zod validation rejection. Service mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/reviews.service.js', () => ({
  createReview:        vi.fn(),
  listByTarget:        vi.fn(),
  aggregateForTarget:  vi.fn(),
  jsonLd:              vi.fn(),
  getReview:           vi.fn(),
  reply:               vi.fn(),
  setStatus:           vi.fn(),
  remove:              vi.fn(),
  vote:                vi.fn(),
  unvote:              vi.fn(),
  listMedia:           vi.fn(),
  attachMedia:         vi.fn(),
  detachMedia:         vi.fn(),
}))

import { reviewsRoutes } from '../routes/reviews.routes.js'
import * as service from '../services/reviews.service.js'

const UUID  = '11111111-1111-1111-1111-111111111111'
const UUID2 = '22222222-2222-2222-2222-222222222222'
const IDENTITY = { appId: 'shop', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'buyer' }

async function buildApp() {
  const app = Fastify({ logger: false })
  // zod-aware passthrough compiler so route-level schema.{body,params} validate.
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
  app.addHook('onRequest', async (req) => { req.identity = IDENTITY })
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.validation) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(400).send({ error: { code: 'BAD_REQUEST' } })
  })
  await app.register(reviewsRoutes)
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/reviews', () => {
  it('201 + delegates with ctx incl jwt from Authorization', async () => {
    service.createReview.mockResolvedValue({ id: UUID })
    const res = await app.inject({
      method: 'POST', url: '/v1/reviews',
      headers: { Authorization: 'Bearer abc.def' },
      payload: { targetType: 'product', targetId: 'sku', rating: 5 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'shop', tenantId: 't1', jwt: 'abc.def' }),
      expect.objectContaining({ targetType: 'product', rating: 5 }),
    )
  })

  it('jwt null when no Authorization header', async () => {
    service.createReview.mockResolvedValue({ id: UUID })
    await app.inject({
      method: 'POST', url: '/v1/reviews',
      payload: { targetType: 'product', targetId: 'sku', rating: 5 },
    })
    expect(service.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ jwt: null }), expect.anything(),
    )
  })

  it('rejects invalid rating', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/reviews',
      payload: { targetType: 'product', targetId: 'sku', rating: 9 },
    })
    expect(res.statusCode).toBe(400)
    expect(service.createReview).not.toHaveBeenCalled()
  })
})

describe('GET list / aggregate / jsonld', () => {
  it('GET /v1/reviews delegates parsed query', async () => {
    service.listByTarget.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/reviews?targetType=product&targetId=sku&limit=5' })
    expect(res.statusCode).toBe(200)
    expect(service.listByTarget).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ targetType: 'product', targetId: 'sku', limit: 5 }),
    )
  })

  it('GET /v1/reviews/aggregate delegates', async () => {
    service.aggregateForTarget.mockResolvedValue({ total: 1 })
    const res = await app.inject({ method: 'GET', url: '/v1/reviews/aggregate?targetType=product&targetId=sku' })
    expect(res.statusCode).toBe(200)
    expect(service.aggregateForTarget).toHaveBeenCalled()
  })

  it('GET /v1/reviews/jsonld (public) delegates', async () => {
    service.jsonLd.mockResolvedValue({ '@context': 'https://schema.org' })
    const res = await app.inject({ method: 'GET', url: '/v1/reviews/jsonld?targetType=product&targetId=sku' })
    expect(res.statusCode).toBe(200)
    expect(service.jsonLd).toHaveBeenCalled()
  })

  it('GET /v1/reviews rejects invalid query (missing targetId)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reviews?targetType=product' })
    expect(res.statusCode).toBe(400)
    expect(service.listByTarget).not.toHaveBeenCalled()
  })
})

describe('GET /v1/reviews/:id', () => {
  it('delegates with id', async () => {
    service.getReview.mockResolvedValue({ id: UUID })
    const res = await app.inject({ method: 'GET', url: `/v1/reviews/${UUID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getReview).toHaveBeenCalledWith(expect.anything(), UUID)
  })
})

describe('POST /v1/reviews/:id/reply', () => {
  it('201 + delegates body', async () => {
    service.reply.mockResolvedValue({ id: 'rp1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/reviews/${UUID}/reply`, payload: { body: 'thanks' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.reply).toHaveBeenCalledWith(expect.anything(), UUID, 'thanks')
  })

  it('rejects empty body', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/reviews/${UUID}/reply`, payload: { body: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /v1/reviews/:id/status', () => {
  it('delegates status', async () => {
    service.setStatus.mockResolvedValue({ id: UUID, status: 'hidden' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/reviews/${UUID}/status`, payload: { status: 'hidden' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.setStatus).toHaveBeenCalledWith(expect.anything(), UUID, 'hidden')
  })
})

describe('DELETE /v1/reviews/:id', () => {
  it('204', async () => {
    service.remove.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/reviews/${UUID}` })
    expect(res.statusCode).toBe(204)
    expect(service.remove).toHaveBeenCalledWith(expect.anything(), UUID)
  })
})

describe('voting routes', () => {
  it('PUT /vote helpful → voteValue 1', async () => {
    service.vote.mockResolvedValue({ helpful_count: 1 })
    const res = await app.inject({
      method: 'PUT', url: `/v1/reviews/${UUID}/vote`, payload: { vote: 'helpful' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.vote).toHaveBeenCalledWith(expect.anything(), UUID, 1)
  })

  it('PUT /vote unhelpful → voteValue -1', async () => {
    service.vote.mockResolvedValue({ unhelpful_count: 1 })
    await app.inject({
      method: 'PUT', url: `/v1/reviews/${UUID}/vote`, payload: { vote: 'unhelpful' },
    })
    expect(service.vote).toHaveBeenCalledWith(expect.anything(), UUID, -1)
  })

  it('DELETE /vote delegates unvote', async () => {
    service.unvote.mockResolvedValue({ helpful_count: 0 })
    const res = await app.inject({ method: 'DELETE', url: `/v1/reviews/${UUID}/vote` })
    expect(res.statusCode).toBe(200)
    expect(service.unvote).toHaveBeenCalledWith(expect.anything(), UUID)
  })
})

describe('media routes', () => {
  it('GET /media wraps in { data }', async () => {
    service.listMedia.mockResolvedValue([{ id: 'm1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/reviews/${UUID}/media` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: 'm1' }] })
  })

  it('POST /media → 201', async () => {
    service.attachMedia.mockResolvedValue({ id: 'm1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/reviews/${UUID}/media`,
      payload: { objectId: UUID2, kind: 'photo' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.attachMedia).toHaveBeenCalledWith(
      expect.anything(), UUID, expect.objectContaining({ objectId: UUID2, kind: 'photo' }),
    )
  })

  it('DELETE /media/:mediaId → 204', async () => {
    service.detachMedia.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/reviews/${UUID}/media/${UUID2}` })
    expect(res.statusCode).toBe(204)
    expect(service.detachMedia).toHaveBeenCalledWith(expect.anything(), UUID2)
  })
})
