import { z } from 'zod'
import * as service from '../services/messaging.service.js'

const createThreadBody = z.object({
  buyerUserId:   z.string().uuid(),
  vendorUserId:  z.string().uuid(),
  orderId:       z.string().uuid().optional(),
  subject:       z.string().max(256).optional(),
})

const messageBody = z.object({
  body:        z.string().min(1).max(10000),
  attachments: z.array(z.record(z.any())).optional(),
})

function ctxFromRequest(req) {
  return {
    appId: req.identity.appId,
    tenantId: req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId: req.identity.userId,
    role: req.identity.role,
  }
}

export async function messagingRoutes(fastify) {
  fastify.post('/v1/messages/threads', async (req, reply) => {
    const body = createThreadBody.parse(req.body)
    const t = await service.createThread(ctxFromRequest(req), body)
    return reply.status(201).send(t)
  })

  fastify.get('/v1/messages/threads', async (req) => {
    const role = req.query?.role === 'vendor' ? 'vendor' : 'buyer'
    return service.listThreads(ctxFromRequest(req), role)
  })

  fastify.get('/v1/messages/threads/:id', async (req) => {
    return service.getThread(ctxFromRequest(req), req.params.id)
  })

  fastify.get('/v1/messages/threads/:id/messages', async (req) => {
    const limit  = req.query?.limit  ? Number(req.query.limit)  : undefined
    const offset = req.query?.offset ? Number(req.query.offset) : undefined
    return service.listMessages(ctxFromRequest(req), req.params.id, { limit, offset })
  })

  fastify.post('/v1/messages/threads/:id/messages', async (req, reply) => {
    const body = messageBody.parse(req.body)
    const m = await service.postMessage(ctxFromRequest(req), req.params.id, body.body, body.attachments)
    return reply.status(201).send(m)
  })

  fastify.post('/v1/messages/threads/:id/messages/:mid/read', async (req, reply) => {
    await service.markRead(ctxFromRequest(req), req.params.id, req.params.mid)
    return reply.status(204).send()
  })
}
