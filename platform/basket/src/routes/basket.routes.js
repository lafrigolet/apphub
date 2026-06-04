import { z } from 'zod'
import * as basketService from '../services/basket.service.js'
import * as promosService from '../services/promotions.service.js'

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
const patchQtyBody = z.object({ delta: z.number().int() })

const promoApplyBody  = z.object({ code: z.string().min(1).max(64) })
const promoUpsertBody = z.object({
  type:               z.enum(['percent', 'fixed_amount', 'free_shipping']),
  value:              z.number().int().min(0).optional(),
  minSubtotalCents:   z.number().int().min(0).optional(),
  maxUsesPerUser:     z.number().int().min(1).optional(),
  freeShipping:       z.boolean().optional(),
  expiresAt:          z.string().datetime().optional(),
  enabled:            z.boolean().optional(),
})
const summaryQuery    = z.object({ shippingCents: z.coerce.number().int().min(0).optional() })
const codeParams      = z.object({ code: z.string().min(1).max(64) })

function requireStaff(req, reply) {
  const role = req.identity?.role
  if (!['staff', 'super_admin', 'owner', 'admin'].includes(role)) {
    return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'staff or tenant admin required' } })
  }
}

// Guests carry a client-minted userId and a `guest` role; their carts get the
// shorter TTL window. Authenticated users get the long window.
function isGuestReq(req) {
  return req.identity?.role === 'guest'
}

const tags       = ['basket']
const savedTags  = ['basket · saved-for-later']
const promoTags  = ['basket · promotions']

export async function basketRoutes(fastify) {
  fastify.get('/v1/basket', {
    schema: { tags, summary: 'Get the current user basket' },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.getBasket({ appId, tenantId, userId })
  })

  // Lightweight count for the mini-cart badge — avoids loading every line.
  fastify.get('/v1/basket/count', {
    schema: { tags, summary: 'Fast item/line count + subtotal for the mini-cart badge' },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.getCount({ appId, tenantId, userId })
  })

  fastify.put('/v1/basket/items', {
    schema: { tags, summary: 'Upsert (add or replace) an item in the basket', body: upsertItemBody },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const body = upsertItemBody.parse(req.body)
    return basketService.upsertItem({ appId, tenantId, userId, ...body, isGuest: isGuestReq(req) })
  })

  // Atomic relative quantity change (delta may be negative; result clamped ≥1).
  fastify.patch('/v1/basket/items/:itemId/quantity', {
    schema: {
      tags,
      summary: 'Atomically increment/decrement an item quantity (clamped at 1)',
      params: itemIdParams, body: patchQtyBody,
    },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const { delta } = patchQtyBody.parse(req.body)
    return basketService.patchQuantity({ appId, tenantId, userId, itemId: req.params.itemId, delta, isGuest: isGuestReq(req) })
  })

  fastify.delete('/v1/basket/items/:itemId', {
    schema: { tags, summary: 'Remove one item from the basket', params: itemIdParams },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.removeItem({ appId, tenantId, userId, itemId: req.params.itemId, isGuest: isGuestReq(req) })
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
    return basketService.saveForLater({ appId, tenantId, userId, itemId: body.itemId, isGuest: isGuestReq(req) })
  })

  fastify.post('/v1/basket/saved/:itemId/move-back', {
    schema: { tags: savedTags, summary: 'Move a saved item back into the basket', params: itemIdParams },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.moveBackToBasket({ appId, tenantId, userId, itemId: req.params.itemId, isGuest: isGuestReq(req) })
  })

  fastify.delete('/v1/basket/saved/:itemId', {
    schema: { tags: savedTags, summary: 'Remove an item from saved-for-later', params: itemIdParams },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return basketService.removeSaved({ appId, tenantId, userId, itemId: req.params.itemId, isGuest: isGuestReq(req) })
  })

  // ── Promotions: per-tenant CRUD + per-user apply/clear ──────────────
  fastify.get('/v1/basket/summary', {
    schema: {
      tags,
      summary: 'Compute basket totals (subtotal/discount/shipping/total) including any applied promo',
    },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const { shippingCents } = summaryQuery.parse(req.query ?? {})
    return promosService.basketSummary({ appId, tenantId, userId, shippingCents })
  })

  fastify.post('/v1/basket/promo', {
    schema: { tags: promoTags, summary: 'Apply a promo code to the current user basket', body: promoApplyBody },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    const body = promoApplyBody.parse(req.body)
    return promosService.applyPromo({ appId, tenantId, userId, code: body.code })
  })

  fastify.delete('/v1/basket/promo', {
    schema: { tags: promoTags, summary: 'Remove the applied promo code' },
  }, async (req) => {
    const { appId, tenantId, userId } = req.identity
    return promosService.clearPromo({ appId, tenantId, userId })
  })

  // Tenant-admin / staff: define promo codes for the tenant.
  fastify.get('/v1/basket/promos', {
    schema: { tags: promoTags, summary: 'List promo codes defined for the tenant (staff/admin)' },
  }, async (req, reply) => {
    const guarded = requireStaff(req, reply); if (guarded) return guarded
    const { appId, tenantId } = req.identity
    return { data: await promosService.listPromos({ appId, tenantId }) }
  })

  fastify.put('/v1/basket/promos/:code', {
    schema: {
      tags: promoTags,
      summary: 'Upsert a promo definition (staff/admin)',
      params: codeParams, body: promoUpsertBody,
    },
  }, async (req, reply) => {
    const guarded = requireStaff(req, reply); if (guarded) return guarded
    const { appId, tenantId } = req.identity
    const def = promoUpsertBody.parse(req.body)
    return promosService.upsertPromo({ appId, tenantId, code: req.params.code, def })
  })

  fastify.delete('/v1/basket/promos/:code', {
    schema: { tags: promoTags, summary: 'Delete a promo definition (staff/admin)', params: codeParams },
  }, async (req, reply) => {
    const guarded = requireStaff(req, reply); if (guarded) return guarded
    const { appId, tenantId } = req.identity
    await promosService.deletePromo({ appId, tenantId, code: req.params.code })
    return reply.status(204).send()
  })
}
