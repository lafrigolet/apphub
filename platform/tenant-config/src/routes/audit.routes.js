import { z } from 'zod'
import * as auditService from '../services/audit.service.js'

const listQuery = z.object({
  appId:    z.string().min(1).optional(),
  tenantId: z.string().uuid().optional(),
  limit:    z.coerce.number().int().min(1).max(1000).optional(),
})

export async function auditRoutes(fastify) {
  fastify.get('/v1/audit', async (req) => {
    const query = listQuery.parse(req.query)
    return auditService.listAudit(query, req.identity)
  })
}
