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
  timezone:          z.string().min(1).max(64).optional(),
  metadata:          z.record(z.any()).optional(),
})

// PATCH — every field optional, kind is immutable (would change the booking
// semantics), at least one field required.
const resourcePatchBody = z.object({
  userId:            z.string().uuid().nullable().optional(),
  subTenantId:       z.string().uuid().nullable().optional(),
  displayName:       z.string().min(1).max(256).optional(),
  email:             z.string().email().nullable().optional(),
  phone:             z.string().max(32).nullable().optional(),
  bio:               z.string().max(2048).nullable().optional(),
  capacity:          z.number().int().min(1).optional(),
  internalRateCents: z.number().int().min(0).nullable().optional(),
  isActive:          z.boolean().optional(),
  timezone:          z.string().min(1).max(64).nullable().optional(),
  metadata:          z.record(z.any()).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'at least one field required' })

const activeBody = z.object({ isActive: z.boolean() })

const workHourBody = z.object({
  resourceId:     z.string().uuid(),
  dayOfWeek:      z.number().int().min(0).max(6),
  startMinute:    z.number().int().min(0).max(1439),
  endMinute:      z.number().int().min(0).max(1440),
  effectiveFrom:  z.string().date().optional(),
  effectiveUntil: z.string().date().optional(),
})

const workHourPatchBody = z.object({
  dayOfWeek:      z.number().int().min(0).max(6).optional(),
  startMinute:    z.number().int().min(0).max(1439).optional(),
  endMinute:      z.number().int().min(0).max(1440).optional(),
  effectiveFrom:  z.string().date().nullable().optional(),
  effectiveUntil: z.string().date().nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'at least one field required' })

const exceptionBody = z.object({
  resourceId: z.string().uuid(),
  startsAt:   z.string().datetime(),
  endsAt:     z.string().datetime(),
  kind:       z.enum(['vacation','sick','training','holiday','other']),
  reason:     z.string().max(512).optional(),
})

const exceptionPatchBody = z.object({
  startsAt: z.string().datetime().optional(),
  endsAt:   z.string().datetime().optional(),
  kind:     z.enum(['vacation','sick','training','holiday','other']).optional(),
  reason:   z.string().max(512).nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'at least one field required' })

// Bulk holiday across all active resources of the tenant. The optional
// `kind`/`subTenantId` narrow WHICH resources get blocked (not the exception's
// own kind, which stays in `exceptionKind`).
const holidayBody = z.object({
  startsAt:    z.string().datetime(),
  endsAt:      z.string().datetime(),
  reason:      z.string().max(512).optional(),
  // exception kind to store (defaults to 'holiday')
  exceptionKind: z.enum(['vacation','sick','training','holiday','other']).optional(),
  // filters narrowing which resources are blocked
  kind:        z.enum(['practitioner','room','equipment','vehicle']).optional(),
  subTenantId: z.string().uuid().optional(),
})

const idParams = z.object({ id: z.string().uuid() })

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

const tags = ['resources']

export async function resourcesRoutes(fastify) {
  fastify.post('/v1/resources', {
    schema: { tags, summary: 'Create a bookable resource', body: resourceBody },
  }, async (req, reply) => {
    const body = resourceBody.parse(req.body)
    return reply.status(201).send(await service.createResource(ctxFromRequest(req), body))
  })

  fastify.get('/v1/resources', {
    schema: {
      tags,
      summary: 'List resources (filter by kind and active state)',
      querystring: z.object({
        kind:       z.enum(['practitioner','room','equipment','vehicle']).optional(),
        onlyActive: z.enum(['true','false']).optional(),
      }),
    },
  }, async (req) =>
    service.listResources(ctxFromRequest(req), { kind: req.query?.kind, onlyActive: req.query?.onlyActive !== 'false' }),
  )

  fastify.get('/v1/resources/:id', {
    schema: { tags, summary: 'Get a resource with its services and work hours', params: idParams },
  }, async (req) =>
    service.getResource(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/resources/:id', {
    schema: { tags, summary: 'Update a resource (kind is immutable)', params: idParams, body: resourcePatchBody },
  }, async (req) => {
    const patch = resourcePatchBody.parse(req.body)
    return service.updateResource(ctxFromRequest(req), req.params.id, patch)
  })

  fastify.patch('/v1/resources/:id/active', {
    schema: { tags, summary: 'Activate or deactivate a resource', params: idParams, body: activeBody },
  }, async (req) => {
    const { isActive } = activeBody.parse(req.body)
    return service.setResourceActive(ctxFromRequest(req), req.params.id, isActive)
  })

  fastify.get('/v1/resources/by-service/:serviceId', {
    schema: {
      tags,
      summary: 'List active resources that can deliver a service',
      params: z.object({ serviceId: z.string().uuid() }),
    },
  }, async (req) =>
    service.listResourcesForService(ctxFromRequest(req), req.params.serviceId),
  )

  fastify.post('/v1/resources/:id/services/:serviceId', {
    schema: {
      tags,
      summary: 'Attach a service skill to a resource',
      params: z.object({ id: z.string().uuid(), serviceId: z.string().uuid() }),
    },
  }, async (req, reply) => {
    await service.attachService(ctxFromRequest(req), req.params.id, req.params.serviceId)
    return reply.status(204).send()
  })

  fastify.delete('/v1/resources/:id/services/:serviceId', {
    schema: {
      tags,
      summary: 'Detach a service skill from a resource',
      params: z.object({ id: z.string().uuid(), serviceId: z.string().uuid() }),
    },
  }, async (req, reply) => {
    await service.detachService(ctxFromRequest(req), req.params.id, req.params.serviceId)
    return reply.status(204).send()
  })

  // Work hours
  fastify.post('/v1/resources/work-hours', {
    schema: { tags, summary: 'Add a weekly work-hours slot to a resource', body: workHourBody },
  }, async (req, reply) => {
    const body = workHourBody.parse(req.body)
    return reply.status(201).send(await service.setWorkHour(ctxFromRequest(req), body))
  })

  fastify.patch('/v1/resources/work-hours/:id', {
    schema: { tags, summary: 'Update a weekly work-hours slot', params: idParams, body: workHourPatchBody },
  }, async (req) => {
    const patch = workHourPatchBody.parse(req.body)
    return service.updateWorkHour(ctxFromRequest(req), req.params.id, patch)
  })

  fastify.get('/v1/resources/:id/work-hours', {
    schema: { tags, summary: "List a resource's weekly work hours", params: idParams },
  }, async (req) =>
    service.listWorkHours(ctxFromRequest(req), req.params.id),
  )

  fastify.delete('/v1/resources/work-hours/:id', {
    schema: { tags, summary: 'Delete a weekly work-hours slot', params: idParams },
  }, async (req, reply) => {
    await service.deleteWorkHour(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })

  // Exceptions
  fastify.post('/v1/resources/exceptions', {
    schema: { tags, summary: 'Create a one-off exception (vacation, sick, holiday…)', body: exceptionBody },
  }, async (req, reply) => {
    const body = exceptionBody.parse(req.body)
    return reply.status(201).send(await service.createException(ctxFromRequest(req), body))
  })

  fastify.post('/v1/resources/holidays', {
    schema: {
      tags,
      summary: 'Bulk-create an exception across all active resources of the tenant',
      body: holidayBody,
    },
  }, async (req, reply) => {
    const b = holidayBody.parse(req.body)
    return reply.status(201).send(await service.createTenantHolidays(ctxFromRequest(req), b))
  })

  fastify.patch('/v1/resources/exceptions/:id', {
    schema: { tags, summary: 'Update a one-off exception', params: idParams, body: exceptionPatchBody },
  }, async (req) => {
    const patch = exceptionPatchBody.parse(req.body)
    return service.updateException(ctxFromRequest(req), req.params.id, patch)
  })

  fastify.delete('/v1/resources/exceptions/:id', {
    schema: { tags, summary: 'Delete a one-off exception', params: idParams },
  }, async (req, reply) => {
    await service.deleteException(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })

  fastify.get('/v1/resources/:id/exceptions', {
    schema: {
      tags,
      summary: "List a resource's exceptions in a time window",
      params: idParams,
      querystring: z.object({
        from: z.string().datetime().optional(),
        to:   z.string().datetime().optional(),
      }),
    },
  }, async (req) =>
    service.listExceptions(ctxFromRequest(req), req.params.id, { from: req.query?.from, to: req.query?.to }),
  )
}
