import { pool, setTenantContext } from '../lib/db.js'
import * as reportRepo from '../repositories/reporting.repository.js'
import { requireRole } from '../plugins/auth.js'

export async function reportRoutes(fastify) {
  fastify.get('/dashboard', { preHandler: requireRole('admin', 'instructor') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const metrics = await reportRepo.getDashboard(client, tenantId)
      return reply.send({ data: metrics })
    } finally {
      client.release()
    }
  })

  fastify.get('/attendance', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const { from, to } = req.query
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const data = await reportRepo.getAttendance(client, tenantId, { from, to })
      return reply.send({ data })
    } finally {
      client.release()
    }
  })

  fastify.post('/attendance/export', { preHandler: requireRole('admin') }, async (req, reply) => {
    return reply.send({ data: { message: 'Export queued. You will receive an email when ready.' } })
  })
}
