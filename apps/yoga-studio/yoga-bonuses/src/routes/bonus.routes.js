import { pool, setTenantContext } from '../lib/db.js'
import * as bonusRepo from '../repositories/bonus.repository.js'

export async function bonusRoutes(fastify) {
  fastify.get('/me', async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const bonuses = await bonusRepo.getActiveBonuses(client, userId, tenantId)
      return reply.send({ data: bonuses })
    } finally {
      client.release()
    }
  })
}
