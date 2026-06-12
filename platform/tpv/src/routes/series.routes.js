import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/series.service.js'

const tags = ['tpv · series']

const createBody = z.object({
  code:     z.string().min(1).max(8),
  kind:     z.enum(['simplified', 'invoice', 'credit_note']),
  prefix:   z.string().max(16).optional(),
  deviceId: z.string().uuid().optional().nullable(),
})

const listQuery = z.object({
  kind:   z.enum(['simplified', 'invoice', 'credit_note']).optional(),
  active: z.coerce.boolean().optional(),
})

export async function seriesRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('manager', 'owner', 'admin', 'staff', 'super_admin'))

  fastify.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create a sequential numbering series (gap-free, fiscal)',
        body: createBody,
      },
    },
    async (req, reply) => {
      const body = createBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.createSeries(req.tenant, body) }
    },
  )

  fastify.get(
    '/',
    {
      schema: { tags, summary: 'List numbering series of the tenant', querystring: listQuery },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listSeries(req.tenant, q) }
    },
  )
}
