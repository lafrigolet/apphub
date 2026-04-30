import { z } from 'zod'
import * as service from '../services/reviews.service.js'

const createBody = z.object({
  targetType: z.enum(['product', 'vendor']),
  targetId:   z.string().min(1).max(256),
  orderId:    z.string().uuid().optional(),
  rating:     z.number().int().min(1).max(5),
  title:      z.string().max(256).optional(),
  body:       z.string().max(4000).optional(),
  status:     z.enum(['pending', 'published']).optional(),
})

const replyBody  = z.object({ body: z.string().min(1).max(4000) })
const statusBody = z.object({ status: z.enum(['pending', 'published', 'hidden', 'removed']) })

const listQuery = z.object({
  targetType:   z.enum(['product', 'vendor']),
  targetId:     z.string().min(1),
  status:       z.enum(['pending', 'published', 'hidden', 'removed']).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  limit:        z.coerce.number().int().min(1).max(200).optional(),
  offset:       z.coerce.number().int().min(0).optional(),
})

function ctxFromRequest(req) {
  return {
    appId: req.identity.appId,
    tenantId: req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId: req.identity.userId,
    role: req.identity.role,
    // Forward the raw JWT so the service can call orders/:id loopback as
    // the same user. RLS in platform_orders enforces tenant isolation.
    jwt: req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? null,
  }
}

export async function reviewsRoutes(fastify) {
  fastify.post('/v1/reviews', async (req, reply) => {
    const body = createBody.parse(req.body)
    const r = await service.createReview(ctxFromRequest(req), body)
    return reply.status(201).send(r)
  })

  fastify.get('/v1/reviews', async (req) => {
    const q = listQuery.parse(req.query)
    return service.listByTarget(ctxFromRequest(req), q)
  })

  fastify.get('/v1/reviews/aggregate', async (req) => {
    const q = listQuery.parse(req.query)
    return service.aggregateForTarget(ctxFromRequest(req), q)
  })

  fastify.get('/v1/reviews/:id', async (req) => {
    return service.getReview(ctxFromRequest(req), req.params.id)
  })

  fastify.post('/v1/reviews/:id/reply', async (req, reply) => {
    const b = replyBody.parse(req.body)
    const r = await service.reply(ctxFromRequest(req), req.params.id, b.body)
    return reply.status(201).send(r)
  })

  fastify.patch('/v1/reviews/:id/status', async (req) => {
    const b = statusBody.parse(req.body)
    return service.setStatus(ctxFromRequest(req), req.params.id, b.status)
  })

  fastify.delete('/v1/reviews/:id', async (req, reply) => {
    await service.remove(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })
}
