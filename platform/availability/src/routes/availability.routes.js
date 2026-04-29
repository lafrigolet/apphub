import { z } from 'zod'
import * as service from '../services/availability.service.js'

const slotsQuery = z.object({
  serviceId:  z.string().uuid(),
  resourceId: z.string().uuid().optional(),
  from:       z.string().datetime(),
  to:         z.string().datetime(),
})

const holdBody = z.object({
  serviceId:   z.string().uuid(),
  resourceId:  z.string().uuid(),
  startsAt:    z.string().datetime(),
  endsAt:      z.string().datetime(),
  ttlSeconds:  z.number().int().positive().max(3600).optional(),
})

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function availabilityRoutes(fastify) {
  fastify.get('/v1/availability/slots', async (req) => {
    const q = slotsQuery.parse(req.query)
    return service.listSlots(ctxFromRequest(req), q)
  })

  fastify.post('/v1/availability/holds', async (req, reply) => {
    const body = holdBody.parse(req.body)
    return reply.status(201).send(await service.holdSlot(ctxFromRequest(req), body))
  })

  fastify.delete('/v1/availability/holds/:id', async (req, reply) => {
    await service.releaseHold(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })
}
