import { z } from 'zod'
import * as service from '../services/resources.service.js'
import { tenantFromRequest } from '../lib/tenant-ctx.js'

const querySchema = z.object({
  type:     z.enum(['video', 'document', 'guide']).optional(),
  tenantId: z.string().uuid().optional(),
})

export async function resourcesRoutes(fastify) {
  // V1: público. En V2, cuando enchufemos auth real, se podrá filtrar por
  // `requires_membership` y devolver presigned URLs del storage solo a
  // socios autenticados.
  fastify.get('/v1/aulavera/resources', { config: { public: true } }, async (req) => {
    const { type } = querySchema.parse(req.query ?? {})
    return service.listResources(tenantFromRequest(req), { type })
  })
}
