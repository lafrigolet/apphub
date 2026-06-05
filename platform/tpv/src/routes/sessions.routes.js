import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/sessions.service.js'

const tags = ['tpv · sessions']

const OPERATOR_ROLES = ['cashier', 'staff', 'manager', 'owner', 'admin', 'super_admin']

const openBody = z.object({
  deviceId:          z.string().uuid(),
  openingFloatCents: z.number().int().min(0).default(0),
})

const closeBody = z.object({
  // conteo declarado por método de pago: {"cash": 12345, "card": 6789, ...}
  declared:       z.record(z.number().int().min(0)),
  varianceReason: z.string().max(500).optional().nullable(),
})

const countBody = z.object({
  counted: z.record(z.number().int().min(0)),
  note:    z.string().max(500).optional().nullable(),
})

const movementBody = z.object({
  kind:        z.enum(['cash_in', 'cash_out']),
  amountCents: z.number().int().positive(),
  reason:      z.string().min(1).max(500),
})

const idParams = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  deviceId: z.string().uuid().optional(),
  status:   z.enum(['open', 'closed', 'force_closed']).optional(),
  from:     z.string().datetime().optional(),
  to:       z.string().datetime().optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(100),
  offset:   z.coerce.number().int().min(0).default(0),
})

export async function sessionsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole(...OPERATOR_ROLES))

  fastify.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Open a cash session on a device (one open session per device)',
        body: openBody,
      },
    },
    async (req, reply) => {
      const body = openBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.openSession(req.identity, body) }
    },
  )

  fastify.get(
    '/',
    {
      schema: { tags, summary: 'List cash sessions (filters: device, status, dates)', querystring: listQuery },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listSessions(req.identity, q) }
    },
  )

  fastify.get(
    '/:id',
    {
      schema: { tags, summary: 'Get a cash session with movements, counts and theoretical cash', params: idParams },
    },
    async (req) => ({ data: await service.getSession(req.identity, req.params.id) }),
  )

  fastify.post(
    '/:id/close',
    {
      schema: {
        tags,
        summary: 'Close a cash session — declared vs theoretical count, records variance',
        params: idParams,
        body: closeBody,
      },
    },
    async (req) => {
      const body = closeBody.parse(req.body ?? {})
      return { data: await service.closeSession(req.identity, req.params.id, body) }
    },
  )

  fastify.post(
    '/:id/reopen',
    {
      preHandler: requireRole('manager', 'owner', 'admin'),
      schema: { tags, summary: 'Reopen a closed session (manager only, audited)', params: idParams },
    },
    async (req) => ({ data: await service.reopenSession(req.identity, req.params.id) }),
  )

  fastify.post(
    '/:id/counts',
    {
      schema: {
        tags,
        summary: 'Blind cash count (arqueo) without closing the session',
        params: idParams,
        body: countBody,
      },
    },
    async (req, reply) => {
      const body = countBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.addCount(req.identity, req.params.id, body) }
    },
  )

  fastify.get(
    '/:id/movements',
    {
      schema: { tags, summary: 'List cash movements of a session (append-only audit)', params: idParams },
    },
    async (req) => ({ data: await service.listMovements(req.identity, req.params.id) }),
  )

  fastify.post(
    '/:id/movements',
    {
      schema: {
        tags,
        summary: 'Record a manual cash movement (cash-in / cash-out, reason required)',
        params: idParams,
        body: movementBody,
      },
    },
    async (req, reply) => {
      const body = movementBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.addMovement(req.identity, req.params.id, body) }
    },
  )
}
