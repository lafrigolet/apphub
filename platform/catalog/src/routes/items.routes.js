import { z } from 'zod'
import * as itemsService from '../services/items.service.js'

const createItemBody = z.object({
  name:        z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  priceCents:  z.number().int().min(0).optional(),
  currency:    z.string().length(3).optional(),
  category:    z.string().max(64).optional(),
  metadata:    z.record(z.unknown()).optional(),
})

const updateItemBody = z.object({
  name:        z.string().min(1).max(256).optional(),
  description: z.string().max(2048).optional(),
  priceCents:  z.number().int().min(0).optional(),
  currency:    z.string().length(3).optional(),
  category:    z.string().max(64).optional(),
  metadata:    z.record(z.unknown()).optional(),
  active:      z.boolean().optional(),
})

export async function itemsRoutes(fastify) {
  fastify.get('/v1/items', async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const activeOnly = req.query.activeOnly !== 'false'
    return itemsService.listItems({ appId, tenantId, subTenantId, activeOnly })
  })

  fastify.get('/v1/items/:id', async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return itemsService.getItem({ appId, tenantId, subTenantId, id: req.params.id })
  })

  fastify.post('/v1/items', async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = createItemBody.parse(req.body)
    const item = await itemsService.createItem({ appId, tenantId, subTenantId, ...body })
    return reply.status(201).send(item)
  })

  fastify.patch('/v1/items/:id', async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = updateItemBody.parse(req.body)
    return itemsService.updateItem({ appId, tenantId, subTenantId, id: req.params.id, ...body })
  })

  fastify.delete('/v1/items/:id', async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    await itemsService.deleteItem({ appId, tenantId, subTenantId, id: req.params.id })
    return reply.status(204).send()
  })
}
