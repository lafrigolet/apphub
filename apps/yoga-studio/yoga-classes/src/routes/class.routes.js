import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import { env } from '../lib/env.js'
import { cacheGet, cacheSet, cacheDelete, publish } from '../lib/redis.js'
import * as classRepo from '../repositories/class.repository.js'
import { requireRole } from '../plugins/auth.js'
import { NotFoundError } from '../utils/errors.js'

const CLASS_CACHE_KEY = 'classes:catalog'
const CACHE_TTL = 300 // 5 minutes

const createBody = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['hatha', 'vinyasa', 'yin', 'restaurativo', 'power', 'mindfulness']),
  instructorId: z.string().uuid(),
  room: z.string().max(20),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(180),
  maxCapacity: z.number().int().min(1).max(100),
  level: z.enum(['todos', 'principiante', 'intermedio', 'avanzado']).default('todos'),
  recurrence: z.enum(['none', 'weekly', 'biweekly']).default('none'),
  equipment: z.array(z.string()).default([]),
})

export async function classRoutes(fastify) {
  // Public catalog — uses env tenant (no user auth context available)
  fastify.get('/', { config: { public: true } }, async (req, reply) => {
    const tenantId = env.YOGA_TENANT_ID
    const subTenantId = env.YOGA_SUB_TENANT_ID ?? null

    const cached = await cacheGet(tenantId, CLASS_CACHE_KEY)
    if (cached) return reply.send({ data: cached })

    const { type, level } = req.query
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const classes = await classRepo.listClasses(client, tenantId, { type, level })
      await cacheSet(tenantId, CLASS_CACHE_KEY, classes, CACHE_TTL)
      return reply.send({ data: classes })
    } finally {
      client.release()
    }
  })

  fastify.get('/:id/availability', async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const cls = await classRepo.findById(client, req.params.id, tenantId)
      if (!cls) throw new NotFoundError('Class')
      return reply.send({ data: { classId: cls.id, maxCapacity: cls.max_capacity } })
    } finally {
      client.release()
    }
  })

  fastify.get('/instructor/agenda', { preHandler: requireRole('instructor', 'admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const instructorId = req.query.instructorId ?? req.user.userId
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const sessions = await classRepo.getInstructorSessions(client, instructorId, tenantId)
      return reply.send({ data: sessions })
    } finally {
      client.release()
    }
  })

  fastify.post('/', { schema: { body: createBody }, preHandler: requireRole('admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const cls = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      return classRepo.createClass(client, { id: uuidv4(), ...req.body, tenantId, subTenantId })
    })
    await cacheDelete(tenantId, CLASS_CACHE_KEY)
    return reply.status(201).send({ data: cls })
  })

  fastify.put('/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const cls = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      const updated = await classRepo.updateClass(client, req.params.id, tenantId, req.body)
      if (!updated) throw new NotFoundError('Class')
      return updated
    })
    await cacheDelete(tenantId, CLASS_CACHE_KEY)
    await publish({ type: 'class.modified', payload: { classId: cls.id, tenantId, subTenantId } })
    return reply.send({ data: cls })
  })

  fastify.delete('/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    await withTenantTransaction(tenantId, subTenantId, async (client) => {
      const cls = await classRepo.findById(client, req.params.id, tenantId)
      if (!cls) throw new NotFoundError('Class')
      await classRepo.deactivateClass(client, req.params.id, tenantId)
      await publish({ type: 'class.cancelled', payload: { classId: req.params.id, tenantId, subTenantId } })
    })
    await cacheDelete(tenantId, CLASS_CACHE_KEY)
    return reply.status(204).send()
  })
}
