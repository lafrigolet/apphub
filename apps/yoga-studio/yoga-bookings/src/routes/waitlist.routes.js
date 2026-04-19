import { pool, setTenantContext } from '../lib/db.js'
import * as bookingRepo from '../repositories/booking.repository.js'

export async function waitlistRoutes(fastify) {
  fastify.get('/:sessionId', async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const entry = await bookingRepo.getWaitlistPosition(client, userId, req.params.sessionId, tenantId)
      return reply.send({ data: entry })
    } finally {
      client.release()
    }
  })
}
