import { z } from 'zod'
import * as basketService from '../services/basket.service.js'

const upsertItemBody = z.object({
  itemId:     z.string().min(1),
  quantity:   z.number().int().min(1),
  name:       z.string().min(1).max(256),
  priceCents: z.number().int().min(0),
  metadata:   z.record(z.unknown()).optional(),
})

const mergeBody = z.object({ guestUserId: z.string().min(1).max(128) })
const itemIdBody = z.object({ itemId: z.string().min(1) })
const itemIdParams = z.object({ itemId: z.string().min(1) })

const tags      = ['basket']
const savedTags = ['basket · saved-for-later']

export async function basketRoutes(fastify) {
  fastify.get('/v1/basket', {
    schema: { tags, summary: 'Get the current user basket' },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.getBasket({ appId, tenantId, userId })
  })

  fastify.put('/v1/basket/items', {
    schema: { tags, summary: 'Upsert (add or replace) an item in the basket', body: upsertItemBody },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const body = upsertItemBody.parse(req.body)
    return basketService.upsertItem({ appId, tenantId, userId, ...body })
  })

  fastify.delete('/v1/basket/items/:itemId', {
    schema: { tags, summary: 'Remove one item from the basket', params: itemIdParams },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.removeItem({ appId, tenantId, userId, itemId: req.params.itemId })
  })

  fastify.delete('/v1/basket', {
    schema: { tags, summary: 'Empty the basket' },
  }, async (req, reply) => {
    const { appId, tenantId, userId } = req.identity
    await basketService.clearBasket({ appId, tenantId, userId })
    return reply.status(204).send()
  })

  // ── Merge guest → authenticated basket on login ───────────────────
  fastify.post('/v1/basket/merge', {
    schema: {
      tags,
      summary: 'Merge a guest basket (by guestUserId) into the authenticated user basket',
      body: mergeBody,
    },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const body = mergeBody.parse(req.body)
    return basketService.mergeBaskets({ appId, tenantId, userId, guestUserId: body.guestUserId })
  })

  // ── Saved-for-later (parallel queue) ──────────────────────────────
  fastify.get('/v1/basket/saved', {
    schema: { tags: savedTags, summary: 'List items saved for later' },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.listSaved({ appId, tenantId, userId })
  })

  fastify.post('/v1/basket/saved', {
    schema: { tags: savedTags, summary: 'Move an item from the basket to saved-for-later', body: itemIdBody },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const body = itemIdBody.parse(req.body)
    return basketService.saveForLater({ appId, tenantId, userId, itemId: body.itemId })
  })

  fastify.post('/v1/basket/saved/:itemId/move-back', {
    schema: { tags: savedTags, summary: 'Move a saved item back into the basket', params: itemIdParams },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.moveBackToBasket({ appId, tenantId, userId, itemId: req.params.itemId })
  })

  fastify.delete('/v1/basket/saved/:itemId', {
    schema: { tags: savedTags, summary: 'Remove an item from saved-for-later', params: itemIdParams },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.removeSaved({ appId, tenantId, userId, itemId: req.params.itemId })
  })
}
