import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/billing-facts.service.js'

const tags = ['tpv · billing-facts']

const listQuery = z.object({
  status: z.enum(['pending', 'receipted', 'cancelled']).optional(),
  orphan: z.coerce.boolean().optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const attributeBody = z.object({
  sessionId: z.string().uuid(),
})

const idParams = z.object({ id: z.string().uuid() })

export async function billingFactsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('cashier', 'staff', 'manager', 'owner', 'admin', 'super_admin'))

  fastify.get(
    '/',
    {
      schema: {
        tags,
        summary: 'List billing facts (paid pos bills pending receipt; orphan=true → no session attributed)',
        querystring: listQuery,
      },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listFacts(req.identity, q) }
    },
  )

  fastify.patch(
    '/:id/attribute',
    {
      preHandler: requireRole('manager', 'owner', 'admin', 'staff', 'super_admin'),
      schema: {
        tags,
        summary: 'Attribute an orphan billing fact to an open cash session (replays cash imputation)',
        params: idParams,
        body: attributeBody,
      },
    },
    async (req) => {
      const body = attributeBody.parse(req.body ?? {})
      return { data: await service.attributeFact(req.identity, req.params.id, body) }
    },
  )
}
