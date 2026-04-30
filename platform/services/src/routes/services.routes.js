import { z } from 'zod'
import * as service from '../services/services.service.js'

const serviceBody = z.object({
  code:                 z.string().min(1).max(64),
  name:                 z.string().min(1).max(256),
  description:          z.string().max(2048).optional(),
  category:             z.string().max(128).optional(),
  modality:             z.enum(['in_person','telehealth','at_home','hybrid']).optional(),
  durationMinutes:      z.number().int().positive(),
  bufferBeforeMinutes:  z.number().int().min(0).optional(),
  bufferAfterMinutes:   z.number().int().min(0).optional(),
  priceCents:           z.number().int().min(0).optional(),
  currency:             z.string().length(3).optional(),
  cancellationPolicy:   z.record(z.any()).optional(),
  requiresIntakeForm:   z.boolean().optional(),
  intakeFormId:         z.string().uuid().optional(),
  capacity:             z.number().int().min(1).optional(),
  minAge:               z.number().int().min(0).optional(),
  metadata:             z.record(z.any()).optional(),
  isActive:             z.boolean().optional(),
})

const updateBody = serviceBody.partial().omit({ code: true })

const categoryBody = z.object({
  name:         z.string().min(1).max(128),
  displayOrder: z.number().int().optional(),
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

export async function servicesRoutes(fastify) {
  fastify.post('/v1/services', async (req, reply) => {
    const body = serviceBody.parse(req.body)
    return reply.status(201).send(await service.createService(ctxFromRequest(req), body))
  })

  fastify.get('/v1/services', async (req) => service.listServices(ctxFromRequest(req), {
    onlyActive: req.query?.onlyActive !== 'false',
    category:   req.query?.category,
  }))

  fastify.get('/v1/services/:id', async (req) =>
    service.getService(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/services/:id', async (req) => {
    const body = updateBody.parse(req.body)
    return service.updateService(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/services/:id/deactivate', async (req) =>
    service.deactivateService(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/services/categories', async (req, reply) => {
    const body = categoryBody.parse(req.body)
    return reply.status(201).send(await service.createCategory(ctxFromRequest(req), body))
  })

  fastify.get('/v1/services/categories', async (req) =>
    service.listCategories(ctxFromRequest(req)),
  )
}
