import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/credit-notes.service.js'

const tags = ['tpv · credit-notes']

const createBody = z.object({
  originalReceiptId: z.string().uuid(),
  reason:            z.string().min(1).max(500),
  amountCents:       z.number().int().positive(),
  lines:             z.array(z.object({
    sku:            z.string().optional().nullable(),
    name:           z.string(),
    qty:            z.number().int().positive(),
    unitPriceCents: z.number().int().min(0),
  })).optional(),
  refundMethod:      z.enum(['card', 'cash']),
  sessionId:         z.string().uuid().optional(),    // obligatorio si refundMethod=cash (validado en service)
  refundExternalRef: z.string().max(256).optional().nullable(),
})

const authorizeBody = z.object({
  sessionId:         z.string().uuid().optional(),
  refundExternalRef: z.string().max(256).optional().nullable(),
})

const idParams = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  status:            z.enum(['pending', 'authorized', 'rejected']).optional(),
  originalReceiptId: z.string().uuid().optional(),
  from:              z.string().datetime().optional(),
  to:                z.string().datetime().optional(),
  limit:             z.coerce.number().int().min(1).max(500).default(100),
  offset:            z.coerce.number().int().min(0).default(0),
})

export async function creditNotesRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('cashier', 'staff', 'manager', 'owner', 'admin', 'super_admin'))

  fastify.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Request a credit note against a receipt (auto-authorized if requester is manager+; number assigned on authorization)',
        body: createBody,
      },
    },
    async (req, reply) => {
      const body = createBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.createCreditNote(req.identity, body) }
    },
  )

  fastify.get(
    '/',
    {
      schema: { tags, summary: 'List credit notes (filters: status, original receipt, dates)', querystring: listQuery },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listCreditNotes(req.identity, q) }
    },
  )

  fastify.get(
    '/:id',
    {
      schema: { tags, summary: 'Get a credit note', params: idParams },
    },
    async (req) => ({ data: await service.getCreditNote(req.identity, req.params.id) }),
  )

  fastify.post(
    '/:id/authorize',
    {
      preHandler: requireRole('manager', 'owner', 'admin', 'staff', 'super_admin'),
      schema: {
        tags,
        summary: 'Authorize a pending credit note — consumes sequential number, executes cash refund, publishes tpv.receipt.voided',
        params: idParams,
        body: authorizeBody,
      },
    },
    async (req) => {
      const body = authorizeBody.parse(req.body ?? {})
      return { data: await service.authorizeCreditNote(req.identity, req.params.id, body) }
    },
  )

  fastify.post(
    '/:id/reject',
    {
      preHandler: requireRole('manager', 'owner', 'admin', 'staff', 'super_admin'),
      schema: { tags, summary: 'Reject a pending credit note (no number consumed)', params: idParams },
    },
    async (req) => ({ data: await service.rejectCreditNote(req.identity, req.params.id) }),
  )
}
