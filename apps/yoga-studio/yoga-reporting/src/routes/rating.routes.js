import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import * as reportRepo from '../repositories/reporting.repository.js'

const ratingBody = z.object({
  bookingId: z.string().uuid(),
  classId: z.string().uuid().optional(),
  instructorId: z.string().uuid().optional(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
})

export async function ratingRoutes(fastify) {
  fastify.post('/', { schema: { body: ratingBody } }, async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const rating = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      const created = await reportRepo.createRating(client, {
        id: uuidv4(),
        userId,
        tenantId,
        subTenantId,
        ...req.body,
      })
      if (created && req.body.instructorId) {
        await reportRepo.upsertInstructorSummary(client, req.body.instructorId, tenantId)
      }
      return created
    })
    return reply.status(201).send({ data: rating })
  })

  fastify.get('/instructor/:id', async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const summary = await reportRepo.getInstructorRatings(client, req.params.id, tenantId)
      return reply.send({ data: summary })
    } finally {
      client.release()
    }
  })
}
