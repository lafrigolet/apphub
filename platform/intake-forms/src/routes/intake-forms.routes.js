import { z } from 'zod'
import * as service from '../services/intake-forms.service.js'

const templateBody = z.object({
  code:               z.string().min(1).max(64),
  name:               z.string().min(1).max(256),
  description:        z.string().max(2048).optional(),
  schema:             z.record(z.any()),
  version:            z.number().int().positive().optional(),
  isPublished:        z.boolean().optional(),
  requiresSignature:  z.boolean().optional(),
})

const submissionBody = z.object({
  templateId:        z.string().uuid(),
  bookingId:         z.string().uuid().optional(),
  clientUserId:      z.string().uuid().optional(),
  answers:           z.record(z.any()).optional(),
  signatureUrl:      z.string().url().optional(),
  signatureObjectId: z.string().uuid().optional(),
})

const submitBody = z.object({
  answers:           z.record(z.any()),
  signatureUrl:      z.string().url().optional(),
  signatureObjectId: z.string().uuid().optional(),
})

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function intakeFormsRoutes(fastify) {
  // Templates
  fastify.post('/v1/intake-forms/templates', async (req, reply) => {
    const body = templateBody.parse(req.body)
    return reply.status(201).send(await service.createTemplate(ctxFromRequest(req), body))
  })

  fastify.get('/v1/intake-forms/templates', async (req) =>
    service.listTemplates(ctxFromRequest(req), { onlyPublished: req.query?.onlyPublished === 'true' }),
  )

  fastify.get('/v1/intake-forms/templates/:id', async (req) =>
    service.getTemplate(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/intake-forms/templates/:id/publish', async (req) =>
    service.publishTemplate(ctxFromRequest(req), req.params.id),
  )

  // Submissions
  fastify.post('/v1/intake-forms/submissions', async (req, reply) => {
    const body = submissionBody.parse(req.body)
    return reply.status(201).send(await service.createSubmission(ctxFromRequest(req), body))
  })

  fastify.get('/v1/intake-forms/submissions/:id', async (req) =>
    service.getSubmission(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/intake-forms/submissions/:id/submit', async (req) => {
    const body = submitBody.parse(req.body)
    return service.submitAnswers(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/intake-forms/submissions/:id/review', async (req) =>
    service.reviewSubmission(ctxFromRequest(req), req.params.id),
  )
}
