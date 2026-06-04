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
  // Explicit GDPR consent (art. 7) captured before filling the form (#5).
  consentText:       z.string().max(8192).optional(),
  consentVersion:    z.string().max(64).optional(),
  consentAcceptedAt: z.string().datetime().optional(),
  legalBasis:        z.enum(['consent', 'contract', 'vital_interest', 'legal_obligation']).optional(),
})

const listSubmissionsQuery = z.object({
  status:       z.enum(['pending', 'submitted', 'reviewed']).optional(),
  templateId:   z.string().uuid().optional(),
  clientUserId: z.string().uuid().optional(),
  bookingId:    z.string().uuid().optional(),
  from:         z.string().datetime().optional(),
  to:           z.string().datetime().optional(),
  limit:        z.coerce.number().int().min(1).max(200).optional(),
  offset:       z.coerce.number().int().min(0).optional(),
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

  // Staff listing with filters + pagination (#2). Listed without answers; fetch
  // the individual submission to read decrypted answers.
  fastify.get('/v1/intake-forms/submissions', {
    schema: {
      tags: ['intake-forms · submissions'],
      summary: 'List submissions for staff with filters + pagination',
      querystring: {
        type: 'object',
        properties: {
          status:       { type: 'string', enum: ['pending', 'submitted', 'reviewed'] },
          templateId:   { type: 'string', format: 'uuid' },
          clientUserId: { type: 'string', format: 'uuid' },
          bookingId:    { type: 'string', format: 'uuid' },
          from:         { type: 'string', format: 'date-time' },
          to:           { type: 'string', format: 'date-time' },
          limit:        { type: 'integer', minimum: 1, maximum: 200 },
          offset:       { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (req) =>
    service.listSubmissions(ctxFromRequest(req), listSubmissionsQuery.parse(req.query ?? {})),
  )

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

  // Right to erasure (#5, art. 17 GDPR): anonymise answers + signature, keep
  // the submission skeleton for audit.
  fastify.post('/v1/intake-forms/submissions/:id/erase', {
    schema: {
      tags: ['intake-forms · submissions'],
      summary: 'Anonymise (erase) a submission keeping its audit skeleton',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req) =>
    service.eraseSubmission(ctxFromRequest(req), req.params.id),
  )

  // PDF export of a filled submission. Returns application/pdf bytes with
  // Content-Disposition: attachment; the engine is in
  // packages/platform-sdk/src/simple-pdf.js (Helvetica, text-only, multipage).
  fastify.get('/v1/intake-forms/submissions/:id/pdf', {
    schema: { tags: ['intake-forms · pdf'], summary: 'Download the filled submission as a PDF' },
  }, async (req, reply) => {
    const { filename, pdf } = await service.exportSubmissionPdf(ctxFromRequest(req), req.params.id)
    reply.header('content-type', 'application/pdf')
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    return reply.send(pdf)
  })
}
