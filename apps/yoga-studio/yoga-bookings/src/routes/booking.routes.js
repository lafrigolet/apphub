import { z } from 'zod'
import { pool, setTenantContext } from '../lib/db.js'
import * as bookingRepo from '../repositories/booking.repository.js'
import * as bookingService from '../services/booking.service.js'
import { requireRole } from '../plugins/auth.js'

const createBody = z.object({
  sessionId: z.string().uuid(),
})

const cancelBody = z.object({
  reason: z.string().optional(),
})

export async function bookingRoutes(fastify) {
  fastify.post('/', { schema: { body: createBody } }, async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const result = await bookingService.createBooking({
      userId,
      sessionId: req.body.sessionId,
      tenantId,
      subTenantId,
    })
    return reply.status(201).send({ data: result })
  })

  fastify.get('/', async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const bookings = await bookingRepo.listByUser(client, userId, tenantId)
      return reply.send({ data: bookings })
    } finally {
      client.release()
    }
  })

  fastify.delete('/:id', { schema: { body: cancelBody } }, async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const result = await bookingService.cancelBooking({
      bookingId: req.params.id,
      userId,
      reason: req.body?.reason,
      tenantId,
      subTenantId,
    })
    return reply.send({ data: result })
  })

  fastify.post('/:id/attend', { preHandler: requireRole('instructor', 'admin') }, async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const result = await bookingService.confirmAttendance({
      bookingId: req.params.id,
      instructorId: userId,
      tenantId,
      subTenantId,
    })
    return reply.send({ data: result })
  })
}
