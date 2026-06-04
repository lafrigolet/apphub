import { z } from 'zod'
import * as service from '../services/availability.service.js'

const tags = ['availability']

const slotsQuery = z.object({
  serviceId:  z.string().uuid(),
  resourceId: z.string().uuid().optional(),
  from:       z.string().datetime(),
  to:         z.string().datetime(),
})

const nextQuery = z.object({
  serviceId:  z.string().uuid(),
  resourceId: z.string().uuid().optional(),
  // Rolling-forward search anchor; defaults to now when omitted.
  after:      z.string().datetime().optional(),
})

const holdBody = z.object({
  serviceId:   z.string().uuid(),
  resourceId:  z.string().uuid(),
  startsAt:    z.string().datetime(),
  endsAt:      z.string().datetime(),
  ttlSeconds:  z.number().int().positive().max(3600).optional(),
})

const holdParams = z.object({ id: z.string().uuid() })

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
  fastify.get('/v1/availability/slots', {
    schema: {
      tags,
      summary: 'Compute free slots for a service over a date range (clamped to the service booking window)',
      querystring: slotsQuery,
    },
  }, async (req) => {
    const q = slotsQuery.parse(req.query)
    return service.listSlots(ctxFromRequest(req), q)
  })

  fastify.get('/v1/availability/next', {
    schema: {
      tags,
      summary: 'Find the single earliest available slot (rolling-forward search, max 90 days)',
      querystring: nextQuery,
    },
  }, async (req) => {
    const q = nextQuery.parse(req.query)
    return { slot: await service.nextAvailable(ctxFromRequest(req), q) }
  })

  fastify.post('/v1/availability/holds', {
    schema: {
      tags,
      summary: 'Atomically hold a slot during checkout',
      body: holdBody,
    },
  }, async (req, reply) => {
    const body = holdBody.parse(req.body)
    return reply.status(201).send(await service.holdSlot(ctxFromRequest(req), body))
  })

  fastify.delete('/v1/availability/holds/:id', {
    schema: {
      tags,
      summary: 'Release a previously created hold',
      params: holdParams,
    },
  }, async (req, reply) => {
    await service.releaseHold(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })
}
