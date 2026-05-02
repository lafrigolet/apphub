import { z } from 'zod'
import * as service from '../services/disputes.service.js'

const createBody = z.object({
  orderId:      z.string().uuid(),
  reason:       z.string().min(1).max(128),
  description:  z.string().max(4000).optional(),
})

const messageBody = z.object({
  body:         z.string().min(1).max(10000),
  attachments:  z.array(z.record(z.any())).optional(),
})

const evidenceBody = z.object({
  kind:  z.string().min(1).max(64),
  data:  z.record(z.any()),
})

const resolveBody = z.object({
  status:                 z.enum(['resolved_buyer', 'resolved_vendor', 'escalated_chargeback']),
  resolutionAmountCents:  z.number().int().min(0).optional(),
  resolutionNotes:        z.string().max(2000).optional(),
})

const listQuery = z.object({
  status: z.enum(['open', 'investigating', 'resolved_buyer', 'resolved_vendor', 'escalated_chargeback']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const idParams = z.object({ id: z.string().uuid() })

const tags     = ['disputes']
const stripeTags = ['disputes · stripe sync']

function ctxFromRequest(req) {
  return {
    appId: req.identity.appId,
    tenantId: req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId: req.identity.userId,
    role: req.identity.role,
  }
}

export async function disputesRoutes(fastify) {
  fastify.post('/v1/disputes', {
    schema: { tags, summary: 'Open a dispute on an order', body: createBody },
  }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const d = await service.openDispute(ctxFromRequest(req), body)
    return reply.status(201).send(d)
  })

  fastify.get('/v1/disputes', {
    schema: { tags, summary: 'List disputes (filterable by status)' },
  }, async (req) => {
    const q = listQuery.parse(req.query)
    return service.listDisputes(ctxFromRequest(req), q)
  })

  fastify.get('/v1/disputes/:id', {
    schema: { tags, summary: 'Get a dispute with messages + evidence', params: idParams },
  }, async (req) => {
    return service.getDispute(ctxFromRequest(req), req.params.id)
  })

  fastify.post('/v1/disputes/:id/messages', {
    schema: { tags, summary: 'Post a message in the dispute thread', params: idParams, body: messageBody },
  }, async (req, reply) => {
    const body = messageBody.parse(req.body)
    const m = await service.postMessage(ctxFromRequest(req), req.params.id, body.body, body.attachments)
    return reply.status(201).send(m)
  })

  fastify.post('/v1/disputes/:id/evidence', {
    schema: { tags, summary: 'Upload internal evidence to a dispute', params: idParams, body: evidenceBody },
  }, async (req, reply) => {
    const body = evidenceBody.parse(req.body)
    const e = await service.uploadEvidence(ctxFromRequest(req), req.params.id, body.kind, body.data)
    return reply.status(201).send(e)
  })

  fastify.patch('/v1/disputes/:id/resolve', {
    schema: { tags, summary: 'Resolve a dispute (auto-publishes refund.requested when resolved_buyer)', params: idParams, body: resolveBody },
  }, async (req) => {
    const body = resolveBody.parse(req.body)
    return service.resolve(ctxFromRequest(req), req.params.id, body)
  })

  // ── Stripe dispute API sync (push internal evidence to Stripe) ───────
  fastify.post('/v1/disputes/:id/submit-to-stripe', {
    schema: { tags: stripeTags, summary: 'Forward the collected evidence to Stripe via splitpay', params: idParams },
  }, async (req) => {
    return service.submitEvidenceToStripe(ctxFromRequest(req), req.params.id)
  })
}
