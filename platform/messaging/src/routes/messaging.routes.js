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

const attachmentBody = z.object({
  objectId:     z.string().uuid(),
  kind:         z.enum(['image', 'video', 'file']),
  displayOrder: z.number().int().min(0).max(100).optional(),
})

const idParams       = z.object({ id: z.string().uuid() })
const midParams      = z.object({ id: z.string().uuid(), mid: z.string().uuid() })
const attachIdParams = z.object({ id: z.string().uuid(), mid: z.string().uuid(), attachmentId: z.string().uuid() })

const tags        = ['messaging']
const attachTags  = ['messaging · attachments']

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
  fastify.post('/v1/messages/threads', {
    schema: { tags, summary: 'Create a buyer↔vendor thread', body: createThreadBody },
  }, async (req, reply) => {
    const body = createThreadBody.parse(req.body)
    const t = await service.createThread(ctxFromRequest(req), body)
    return reply.status(201).send(t)
  })

  fastify.get('/v1/messages/threads', {
    schema: { tags, summary: 'List threads for the current user (?role=buyer|vendor)' },
  }, async (req) => {
    const role = req.query?.role === 'vendor' ? 'vendor' : 'buyer'
    return service.listThreads(ctxFromRequest(req), role)
  })

  fastify.get('/v1/messages/threads/:id', {
    schema: { tags, summary: 'Get one thread', params: idParams },
  }, async (req) => {
    return service.getThread(ctxFromRequest(req), req.params.id)
  })

  fastify.get('/v1/messages/threads/:id/messages', {
    schema: { tags, summary: 'List messages in a thread', params: idParams },
  }, async (req) => {
    const limit  = req.query?.limit  ? Number(req.query.limit)  : undefined
    const offset = req.query?.offset ? Number(req.query.offset) : undefined
    return service.listMessages(ctxFromRequest(req), req.params.id, { limit, offset })
  })

  fastify.post('/v1/messages/threads/:id/messages', {
    schema: { tags, summary: 'Post a message to a thread', params: idParams, body: messageBody },
  }, async (req, reply) => {
    const body = messageBody.parse(req.body)
    const m = await service.postMessage(ctxFromRequest(req), req.params.id, body.body, body.attachments)
    return reply.status(201).send(m)
  })

  fastify.post('/v1/messages/threads/:id/messages/:mid/read', {
    schema: { tags, summary: 'Mark a message as read', params: midParams },
  }, async (req, reply) => {
    await service.markRead(ctxFromRequest(req), req.params.id, req.params.mid)
    return reply.status(204).send()
  })

  // ── Unread counts + bulk thread read (inbox UX) ─────────────────────
  fastify.get('/v1/messages/unread-counts', {
    schema: { tags, summary: 'Unread message counts across all of the current user\'s threads' },
  }, async (req) => {
    return service.getUnreadCounts(ctxFromRequest(req))
  })

  fastify.get('/v1/messages/threads/:id/unread-count', {
    schema: { tags, summary: 'Unread message count for one thread (current user)', params: idParams },
  }, async (req) => {
    return service.getThreadUnreadCount(ctxFromRequest(req), req.params.id)
  })

  fastify.post('/v1/messages/threads/:id/read-all', {
    schema: { tags, summary: 'Mark all messages in a thread as read for the current user', params: idParams },
  }, async (req) => {
    return service.markThreadRead(ctxFromRequest(req), req.params.id)
  })

  // ── Storage-backed attachments (preferred over the JSON column) ──────
  fastify.get('/v1/messages/threads/:id/messages/:mid/attachments', {
    schema: { tags: attachTags, summary: 'List storage-backed attachments for a message', params: midParams },
  }, async (req) => {
    return { data: await service.listMessageAttachments(ctxFromRequest(req), req.params.id, req.params.mid) }
  })

  fastify.post('/v1/messages/threads/:id/messages/:mid/attachments', {
    schema: {
      tags: attachTags,
      summary: 'Attach an object (from platform_storage) to an existing message',
      params: midParams, body: attachmentBody,
    },
  }, async (req, reply) => {
    const body = attachmentBody.parse(req.body)
    const r = await service.attachToMessage(ctxFromRequest(req), req.params.id, req.params.mid, body)
    return reply.status(201).send(r)
  })

  fastify.delete('/v1/messages/threads/:id/messages/:mid/attachments/:attachmentId', {
    schema: { tags: attachTags, summary: 'Remove an attachment (sender or staff only)', params: attachIdParams },
  }, async (req, reply) => {
    await service.detachFromMessage(ctxFromRequest(req), req.params.id, req.params.mid, req.params.attachmentId)
    return reply.status(204).send()
  })
}
