import { z } from 'zod'
import * as service from '../services/menu.service.js'

const menuBody = z.object({
  name:        z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  isActive:    z.boolean().optional(),
})

const categoryBody = z.object({
  menuId:       z.string().uuid(),
  name:         z.string().min(1).max(128),
  courseType:   z.enum(['starter','main','dessert','drink','side','combo','other']),
  displayOrder: z.number().int().optional(),
})

const itemBody = z.object({
  categoryId:      z.string().uuid(),
  sku:             z.string().min(1).max(128),
  name:            z.string().min(1).max(256),
  description:     z.string().max(1024).optional(),
  priceCents:      z.number().int().min(0),
  currency:        z.string().length(3).optional(),
  courseType:      z.enum(['starter','main','dessert','drink','side','combo','other']).optional(),
  station:         z.string().max(64).optional(),
  prepTimeSeconds: z.number().int().positive().optional(),
  allergens:       z.array(z.string()).optional(),
  badges:          z.array(z.string()).optional(),
  photoUrl:        z.string().url().optional(),
  isAvailable:     z.boolean().optional(),
  metadata:        z.record(z.any()).optional(),
})

const itemPatchBody = itemBody.partial().omit({ categoryId: true, sku: true })

const availabilityBody = z.object({
  scopeType:    z.enum(['menu','category','item']),
  scopeId:      z.string().uuid(),
  daysOfWeek:   z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute:  z.number().int().min(0).max(1439),
  endMinute:    z.number().int().min(0).max(1440),
  label:        z.string().max(64).optional(),
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

export async function menuRoutes(fastify) {
  fastify.post('/v1/menu/menus', async (req, reply) => {
    const body = menuBody.parse(req.body)
    return reply.status(201).send(await service.createMenu(ctxFromRequest(req), body))
  })

  fastify.get('/v1/menu/menus', async (req) => service.listMenus(ctxFromRequest(req)))
  fastify.get('/v1/menu/menus/:id', async (req) => service.getMenu(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/menu/menus/:id/publish', async (req) =>
    service.publishMenu(ctxFromRequest(req), req.params.id),
  )

  fastify.get('/v1/menu/menus/:id/items', async (req) =>
    service.listAvailableItems(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/menu/categories', async (req, reply) => {
    const body = categoryBody.parse(req.body)
    return reply.status(201).send(await service.createCategory(ctxFromRequest(req), body))
  })

  fastify.post('/v1/menu/items', async (req, reply) => {
    const body = itemBody.parse(req.body)
    return reply.status(201).send(await service.createItem(ctxFromRequest(req), body))
  })

  fastify.patch('/v1/menu/items/:id', async (req) => {
    const body = itemPatchBody.parse(req.body)
    return service.updateItem(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/menu/items/:id/eighty-six', async (req) =>
    service.eightySixItem(ctxFromRequest(req), req.params.id),
  )
  fastify.post('/v1/menu/items/:id/restore', async (req) =>
    service.unEightySixItem(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/menu/availability-windows', async (req, reply) => {
    const body = availabilityBody.parse(req.body)
    return reply.status(201).send(await service.createAvailabilityWindow(ctxFromRequest(req), body))
  })
}
