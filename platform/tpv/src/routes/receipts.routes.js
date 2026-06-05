import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/receipts.service.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import { withTenantTransaction } from '../lib/db.js'
import { renderReceiptHtml } from '../services/receipt-render.js'

const tags = ['tpv · receipts']

const receptorSchema = z.object({
  nif:     z.string().min(1).max(20),
  name:    z.string().min(1).max(256),
  address: z.string().max(512).optional().nullable(),
})

const issueBody = z.object({
  billingFactId: z.string().uuid(),
  type:          z.enum(['simplified', 'invoice']).default('simplified'),
  receptor:      receptorSchema.optional().nullable(),
  seriesCode:    z.string().max(8).optional(),
})

const convertBody = z.object({
  receptor:   receptorSchema,
  seriesCode: z.string().max(8).optional(),
})

const resendBody = z.object({
  email: z.string().email(),
})

const idParams = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  type:      z.enum(['simplified', 'invoice']).optional(),
  status:    z.enum(['issued', 'voided', 'converted']).optional(),
  sessionId: z.string().uuid().optional(),
  from:      z.string().datetime().optional(),
  to:        z.string().datetime().optional(),
  limit:     z.coerce.number().int().min(1).max(500).default(100),
  offset:    z.coerce.number().int().min(0).default(0),
})

export async function receiptsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('cashier', 'staff', 'manager', 'owner', 'admin', 'super_admin'))

  fastify.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Issue a receipt from a pending billing fact (sequential gap-free number, immutable snapshot)',
        body: issueBody,
      },
    },
    async (req, reply) => {
      const body = issueBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.issueReceipt(req.identity, body) }
    },
  )

  fastify.get(
    '/',
    {
      schema: { tags, summary: 'List receipts (filters: type, status, session, dates)', querystring: listQuery },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listReceipts(req.identity, q) }
    },
  )

  fastify.get(
    '/:id',
    {
      schema: { tags, summary: 'Get a receipt with its snapshot lines', params: idParams },
    },
    async (req) => ({ data: await service.getReceipt(req.identity, req.params.id) }),
  )

  fastify.get(
    '/:id/render',
    {
      schema: { tags, summary: 'Render the receipt as printable HTML from the immutable snapshot (idempotent)', params: idParams },
    },
    async (req, reply) => {
      const receipt = await service.getReceipt(req.identity, req.params.id)
      const settings = await withTenantTransaction(
        req.identity.appId, req.identity.tenantId, req.identity.subTenantId,
        (c) => settingsRepo.getOrDefaults(c),
      )
      reply.type('text/html; charset=utf-8')
      return renderReceiptHtml(receipt, receipt.lines, { footer: settings.receipt_footer })
    },
  )

  fastify.post(
    '/:id/resend',
    {
      schema: {
        tags,
        summary: 'Resend the receipt by email (no new fiscal document — publishes to notifications)',
        params: idParams,
        body: resendBody,
      },
    },
    async (req, reply) => {
      const body = resendBody.parse(req.body ?? {})
      reply.code(202)
      return { data: await service.resendReceipt(req.identity, req.params.id, body) }
    },
  )

  fastify.post(
    '/:id/convert',
    {
      schema: {
        tags,
        summary: 'Convert a simplified receipt into a full invoice (within the tenant conversion window)',
        params: idParams,
        body: convertBody,
      },
    },
    async (req, reply) => {
      const body = convertBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.convertReceipt(req.identity, req.params.id, body) }
    },
  )
}
