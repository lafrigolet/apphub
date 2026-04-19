import { pool, setTenantContext } from '../lib/db.js'
import * as classRepo from '../repositories/class.repository.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'

export async function sessionRoutes(fastify) {
  fastify.get('/:id', async (req, reply) => {
    const tenantId = req.user?.tenantId ?? req.headers['x-tenant-id']
    const subTenantId = req.user?.subTenantId ?? req.headers['x-sub-tenant-id'] ?? null
    if (!tenantId) throw new ValidationError('Missing tenant context')

    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const session = await classRepo.findSession(client, req.params.id, tenantId)
      if (!session) throw new NotFoundError('Session')
      return reply.send({ data: session })
    } finally {
      client.release()
    }
  })
}
