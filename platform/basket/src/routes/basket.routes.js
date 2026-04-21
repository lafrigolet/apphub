import { z } from 'zod'
import * as basketService from '../services/basket.service.js'

const upsertItemBody = z.object({
  itemId:     z.string().min(1),
  quantity:   z.number().int().min(1),
  name:       z.string().min(1).max(256),
  priceCents: z.number().int().min(0),
  metadata:   z.record(z.unknown()).optional(),
})

export async function basketRoutes(fastify) {
  fastify.get('/v1/basket', async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.getBasket({ appId, tenantId, userId })
  })

  fastify.put('/v1/basket/items', async (req) => {
    const { appId, tenantId, userId } = req.identity
    const body = upsertItemBody.parse(req.body)
    return basketService.upsertItem({ appId, tenantId, userId, ...body })
  })

  fastify.delete('/v1/basket/items/:itemId', async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.removeItem({ appId, tenantId, userId, itemId: req.params.itemId })
  })

  fastify.delete('/v1/basket', async (req, reply) => {
    const { appId, tenantId, userId } = req.identity
    await basketService.clearBasket({ appId, tenantId, userId })
    return reply.status(204).send()
  })
}
