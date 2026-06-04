import { z } from 'zod'
import * as auditService from '../services/audit.service.js'

const listQuery = z.object({
  appId:    z.string().min(1).optional(),
  tenantId: z.string().uuid().optional(),
  limit:    z.coerce.number().int().min(1).max(1000).optional(),
  // Keyset cursor (#10): ISO timestamp of the last row of the previous page.
  // Pass it to fetch the next (older) page. Omit for the first page.
  before:   z.string().datetime().optional(),
})

export async function auditRoutes(fastify) {
  fastify.get('/v1/audit', {
    schema: {
      tags: ['audit'],
      summary: 'List audit log entries (keyset pagination via `before`)',
      querystring: {
        type: 'object',
        properties: {
          appId:    { type: 'string' },
          tenantId: { type: 'string', format: 'uuid' },
          limit:    { type: 'integer', minimum: 1, maximum: 1000 },
          before:   { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (req) => {
    const query = listQuery.parse(req.query)
    return auditService.listAudit(query, req.identity)
  })
}
