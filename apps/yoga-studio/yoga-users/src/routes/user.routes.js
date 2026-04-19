import { z } from 'zod'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import * as profileRepo from '../repositories/profile.repository.js'
import { requireRole } from '../plugins/auth.js'
import { NotFoundError } from '../utils/errors.js'

const updateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  avatarUrl: z.string().url().optional(),
  preferences: z.record(z.unknown()).optional(),
})

export async function userRoutes(fastify) {
  fastify.get('/me', async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const profile = await profileRepo.findById(client, userId, tenantId)
      if (!profile) throw new NotFoundError('Profile')
      return reply.send({ data: profile })
    } finally {
      client.release()
    }
  })

  fastify.put('/me', { schema: { body: updateBody } }, async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const profile = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      const updated = await profileRepo.updateProfile(client, userId, tenantId, req.body)
      if (!updated) throw new NotFoundError('Profile')
      return updated
    })
    return reply.send({ data: profile })
  })

  fastify.get('/:id', { preHandler: requireRole('instructor', 'admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const profile = await profileRepo.findById(client, req.params.id, tenantId)
      if (!profile) throw new NotFoundError('Profile')
      return reply.send({ data: profile })
    } finally {
      client.release()
    }
  })

  fastify.get('/:id/history', async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const history = await profileRepo.getHistory(client, req.params.id, tenantId)
      return reply.send({ data: history })
    } finally {
      client.release()
    }
  })

  fastify.get('/', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const { search, limit, offset } = req.query
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const profiles = await profileRepo.searchProfiles(client, tenantId, {
        search,
        limit: limit ? parseInt(limit) : 20,
        offset: offset ? parseInt(offset) : 0,
      })
      return reply.send({ data: profiles })
    } finally {
      client.release()
    }
  })
}
