import { z } from 'zod'
import * as service from '../services/inventory.service.js'

const upsertBody = z.object({
  qtyOnHand:          z.number().int().min(0),
  lowStockThreshold:  z.number().int().min(0).optional(),
})

const moveBody = z.object({
  qty:      z.number().int().positive(),
  refType:  z.string().max(64).optional(),
  refId:    z.string().uuid().optional(),
})

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
  }
}

export async function inventoryRoutes(fastify) {
  fastify.get('/v1/inventory', async (req) => {
    const limit  = req.query?.limit  ? Number(req.query.limit)  : undefined
    const offset = req.query?.offset ? Number(req.query.offset) : undefined
    return service.listItems(ctxFromRequest(req), { limit, offset })
  })

  fastify.get('/v1/inventory/:sku', async (req, reply) => {
    const item = await service.getItem(ctxFromRequest(req), req.params.sku)
    if (!item) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'inventory item not found' } })
    return item
  })

  fastify.put('/v1/inventory/:sku', async (req) => {
    const body = upsertBody.parse(req.body)
    return service.upsertItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.post('/v1/inventory/:sku/reserve', async (req) => {
    const body = moveBody.parse(req.body)
    return service.reserveItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.post('/v1/inventory/:sku/release', async (req) => {
    const body = moveBody.parse(req.body)
    return service.releaseItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.post('/v1/inventory/:sku/commit', async (req) => {
    const body = moveBody.parse(req.body)
    return service.commitItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })
}
