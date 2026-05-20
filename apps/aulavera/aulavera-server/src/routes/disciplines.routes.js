import * as service from '../services/disciplines.service.js'
import { tenantFromRequest } from '../lib/tenant-ctx.js'

export async function disciplinesRoutes(fastify) {
  fastify.get('/v1/aulavera/disciplines', { config: { public: true } }, async (req) => {
    return service.listDisciplines(tenantFromRequest(req))
  })
}
