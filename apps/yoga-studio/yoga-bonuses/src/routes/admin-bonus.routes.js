import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { withTenantTransaction } from '../lib/db.js'
import * as bonusRepo from '../repositories/bonus.repository.js'
import { requireRole } from '../plugins/auth.js'

const createTypeBody = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['sessions', 'monthly_unlimited']),
  sessionsCount: z.number().int().positive().optional(),
  validityDays: z.number().int().positive(),
  priceEur: z.number().positive(),
})

const assignBody = z.object({
  userId: z.string().uuid(),
  bonusTypeId: z.string().uuid(),
})

const adjustBody = z.object({
  delta: z.number().int(),
  reason: z.string().min(1),
})

export async function adminBonusRoutes(fastify) {
  fastify.post('/types', {
    schema: { body: createTypeBody },
    preHandler: requireRole('admin'),
  }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const type = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      return bonusRepo.createBonusType(client, { id: uuidv4(), ...req.body, tenantId })
    })
    return reply.status(201).send({ data: type })
  })

  fastify.post('/assign', {
    schema: { body: assignBody },
    preHandler: requireRole('admin'),
  }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const bonus = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      return bonusRepo.assignBonus(client, { id: uuidv4(), ...req.body, tenantId, subTenantId })
    })
    return reply.status(201).send({ data: bonus })
  })

  fastify.put('/:id/adjust', {
    schema: { body: adjustBody },
    preHandler: requireRole('admin'),
  }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    await withTenantTransaction(tenantId, subTenantId, async (client) => {
      await bonusRepo.adjustCredits(client, { bonusId: req.params.id, tenantId, subTenantId, ...req.body })
    })
    return reply.send({ data: { success: true } })
  })
}
