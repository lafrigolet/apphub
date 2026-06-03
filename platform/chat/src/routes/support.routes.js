import { z } from 'zod'
import * as supportService from '../services/support.service.js'

const uuid = z.string().uuid()
const TAG = ['chat · support']

const openBody = z.object({
  subject:  z.string().max(200).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  agentIds: z.array(uuid).max(16).optional(),
})
const queueQuery = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  queue:  z.string().max(64).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(100),
})
const assignBody = z.object({ agentUserId: uuid })
const supportBody = z.object({
  supportStatus: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority:      z.enum(['low', 'normal', 'high', 'urgent']).optional(),
})
const queueBody = z.object({ queue: z.string().max(64).nullable() })
const csatBody = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(2000).optional() })
const macroBody = z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(8000) })

export async function supportRoutes(fastify) {
  const ctx = (req) => req.identity

  fastify.post('/support/conversations', {
    schema: { tags: TAG, summary: 'Open a support conversation', body: openBody },
  }, async (req, reply) => {
    const body = openBody.parse(req.body ?? {})
    const data = await supportService.open(ctx(req), body)
    reply.code(201)
    return { data }
  })

  fastify.get('/support/queue', {
    schema: { tags: TAG, summary: 'Staff: list the support queue', querystring: queueQuery },
  }, async (req) => {
    const q = queueQuery.parse(req.query ?? {})
    return { data: await supportService.queue(ctx(req), q) }
  })

  fastify.post('/conversations/:id/assign', {
    schema: { tags: TAG, summary: 'Staff: assign / reassign an agent', body: assignBody },
  }, async (req) => {
    const body = assignBody.parse(req.body ?? {})
    return { data: await supportService.assign(ctx(req), req.params.id, body.agentUserId) }
  })

  fastify.patch('/conversations/:id/support', {
    schema: { tags: TAG, summary: 'Staff: set support status / priority', body: supportBody },
  }, async (req) => {
    const body = supportBody.parse(req.body ?? {})
    return { data: await supportService.updateSupport(ctx(req), req.params.id, body) }
  })

  fastify.patch('/conversations/:id/queue', {
    schema: { tags: TAG, summary: 'Route a support conversation to a queue', body: queueBody },
  }, async (req) => {
    const body = queueBody.parse(req.body ?? {})
    return { data: await supportService.setQueue(ctx(req), req.params.id, body.queue) }
  })

  // ── CSAT ───────────────────────────────────────────────────────────────────
  fastify.post('/conversations/:id/csat', {
    schema: { tags: TAG, summary: 'Submit a satisfaction rating for a support conversation', body: csatBody },
  }, async (req, reply) => {
    const body = csatBody.parse(req.body ?? {})
    const data = await supportService.submitCsat(ctx(req), req.params.id, body)
    reply.code(201)
    return { data }
  })

  fastify.get('/conversations/:id/csat', {
    schema: { tags: TAG, summary: 'Staff: read CSAT for a support conversation' },
  }, async (req) => ({ data: await supportService.getCsat(ctx(req), req.params.id) }))

  // ── macros (canned responses) ────────────────────────────────────────────────
  fastify.get('/support/macros', {
    schema: { tags: TAG, summary: 'Staff: list canned responses' },
  }, async (req) => ({ data: await supportService.listMacros(ctx(req)) }))

  fastify.post('/support/macros', {
    schema: { tags: TAG, summary: 'Staff: create a canned response', body: macroBody },
  }, async (req, reply) => {
    const body = macroBody.parse(req.body ?? {})
    const data = await supportService.createMacro(ctx(req), body)
    reply.code(201)
    return { data }
  })

  fastify.delete('/support/macros/:id', {
    schema: { tags: TAG, summary: 'Staff: delete a canned response' },
  }, async (req) => ({ data: await supportService.deleteMacro(ctx(req), req.params.id) }))
}
