import { z } from 'zod'
import * as service from '../services/resources.service.js'

const resourceBody = z.object({
  userId:            z.string().uuid().optional(),
  kind:              z.enum(['practitioner','room','equipment','vehicle']),
  displayName:       z.string().min(1).max(256),
  email:             z.string().email().optional(),
  phone:             z.string().max(32).optional(),
  bio:               z.string().max(2048).optional(),
  capacity:          z.number().int().min(1).optional(),
  internalRateCents: z.number().int().min(0).optional(),
  isActive:          z.boolean().optional(),
  metadata:          z.record(z.any()).optional(),
})

const workHourBody = z.object({
  resourceId:     z.string().uuid(),
  dayOfWeek:      z.number().int().min(0).max(6),
  startMinute:    z.number().int().min(0).max(1439),
  endMinute:      z.number().int().min(0).max(1440),
  effectiveFrom:  z.string().date().optional(),
  effectiveUntil: z.string().date().optional(),
})

const exceptionBody = z.object({
  resourceId: z.string().uuid(),
  startsAt:   z.string().datetime(),
  endsAt:     z.string().datetime(),
  kind:       z.enum(['vacation','sick','training','holiday','other']),
  reason:     z.string().max(512).optional(),
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

export async function resourcesRoutes(fastify) {
  fastify.post('/v1/resources', async (req, reply) => {
    const body = resourceBody.parse(req.body)
    return reply.status(201).send(await service.createResource(ctxFromRequest(req), body))
  })

  fastify.get('/v1/resources', async (req) =>
    service.listResources(ctxFromRequest(req), { kind: req.query?.kind, onlyActive: req.query?.onlyActive !== 'false' }),
  )

  fastify.get('/v1/resources/:id', async (req) =>
    service.getResource(ctxFromRequest(req), req.params.id),
  )

  fastify.get('/v1/resources/by-service/:serviceId', async (req) =>
    service.listResourcesForService(ctxFromRequest(req), req.params.serviceId),
  )

  fastify.post('/v1/resources/:id/services/:serviceId', async (req, reply) => {
    await service.attachService(ctxFromRequest(req), req.params.id, req.params.serviceId)
    return reply.status(204).send()
  })

  fastify.delete('/v1/resources/:id/services/:serviceId', async (req, reply) => {
    await service.detachService(ctxFromRequest(req), req.params.id, req.params.serviceId)
    return reply.status(204).send()
  })

  fastify.post('/v1/resources/work-hours', async (req, reply) => {
    const body = workHourBody.parse(req.body)
    return reply.status(201).send(await service.setWorkHour(ctxFromRequest(req), body))
  })

  fastify.get('/v1/resources/:id/work-hours', async (req) =>
    service.listWorkHours(ctxFromRequest(req), req.params.id),
  )

  fastify.delete('/v1/resources/work-hours/:id', async (req, reply) => {
    await service.deleteWorkHour(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })

  fastify.post('/v1/resources/exceptions', async (req, reply) => {
    const body = exceptionBody.parse(req.body)
    return reply.status(201).send(await service.createException(ctxFromRequest(req), body))
  })

  fastify.get('/v1/resources/:id/exceptions', async (req) =>
    service.listExceptions(ctxFromRequest(req), req.params.id, { from: req.query?.from, to: req.query?.to }),
  )
}
