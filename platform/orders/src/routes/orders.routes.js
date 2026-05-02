import { z } from 'zod'
import * as service from '../services/orders.service.js'

const itemSchema = z.object({
  sku:             z.string().min(1).max(128),
  productName:     z.string().min(1).max(256),
  qty:             z.number().int().positive(),
  unitPriceCents:  z.number().int().min(0),
  vendorTenantId:  z.string().uuid().optional(),
  metadata:        z.record(z.any()).optional(),
})

const addressSchema = z.object({
  fullName:    z.string().max(128).optional(),
  line1:       z.string().max(256).optional(),
  line2:       z.string().max(256).optional(),
  city:        z.string().max(128).optional(),
  region:      z.string().max(128).optional(),
  postalCode:  z.string().max(32).optional(),
  country:     z.string().length(2).optional(),
  phone:       z.string().max(32).optional(),
})

const createBody = z.object({
  currency:        z.string().length(3),
  items:           z.array(itemSchema).min(1),
  taxCents:        z.number().int().min(0).optional(),
  shippingCents:   z.number().int().min(0).optional(),
  shippingAddress: addressSchema.optional(),
  billingAddress:  addressSchema.optional(),
  idempotencyKey:  z.string().max(256).optional(),
  metadata:        z.record(z.any()).optional(),
})

const statusBody = z.object({
  status: z.enum(['paid', 'fulfilled', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded']),
  reason: z.string().max(512).optional(),
})

const cancelBody = z.object({ reason: z.string().max(512).optional() })

const shippingAddressBody = addressSchema.extend({ reason: z.string().max(512).optional() })

const noteBody = z.object({ note: z.string().min(1).max(2048) })

const idParams = z.object({ id: z.string().uuid() })

const tags = ['orders']

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function ordersRoutes(fastify) {
  fastify.post('/v1/orders', {
    schema: { tags, summary: 'Create an order', body: createBody },
  }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const order = await service.createOrder(ctxFromRequest(req), body)
    return reply.status(201).send(order)
  })

  fastify.get('/v1/orders', {
    schema: { tags, summary: 'List orders' },
  }, async (req) => {
    const buyerUserId = req.query?.buyerUserId
    const status      = req.query?.status
    const limit       = req.query?.limit  ? Number(req.query.limit)  : undefined
    const offset      = req.query?.offset ? Number(req.query.offset) : undefined
    return service.listOrders(ctxFromRequest(req), { buyerUserId, status, limit, offset })
  })

  fastify.get('/v1/orders/:id', {
    schema: { tags, summary: 'Get one order with items, addresses and history', params: idParams },
  }, async (req) => {
    return service.getOrder(ctxFromRequest(req), req.params.id)
  })

  fastify.patch('/v1/orders/:id/status', {
    schema: { tags, summary: 'Transition order status (FSM)', params: idParams, body: statusBody },
  }, async (req) => {
    const body = statusBody.parse(req.body)
    return service.changeStatus(ctxFromRequest(req), req.params.id, body.status, body.reason)
  })

  fastify.post('/v1/orders/:id/cancel', {
    schema: { tags, summary: 'Cancel an order', params: idParams, body: cancelBody },
  }, async (req) => {
    const body = cancelBody.parse(req.body)
    return service.cancelOrder(ctxFromRequest(req), req.params.id, body.reason)
  })

  fastify.post('/v1/orders/:id/refund', {
    schema: { tags, summary: 'Mark order as refunded', params: idParams, body: cancelBody },
  }, async (req) => {
    const body = cancelBody.parse(req.body)
    return service.refundOrder(ctxFromRequest(req), req.params.id, body.reason)
  })

  // ── Order modifications (audit trail) ──────────────────────────────────
  fastify.get('/v1/orders/:id/modifications', {
    schema: { tags: ['orders · modifications'], summary: 'List post-creation modifications for an order', params: idParams },
  }, async (req) => {
    return { data: await service.listModifications(ctxFromRequest(req), req.params.id) }
  })

  fastify.put('/v1/orders/:id/shipping-address', {
    schema: {
      tags: ['orders · modifications'],
      summary: 'Replace the shipping address (only allowed before fulfilment)',
      params: idParams, body: shippingAddressBody,
    },
  }, async (req) => {
    const body = shippingAddressBody.parse(req.body)
    const { reason, ...address } = body
    return service.changeShippingAddress(ctxFromRequest(req), req.params.id, address, reason)
  })

  fastify.post('/v1/orders/:id/notes', {
    schema: { tags: ['orders · modifications'], summary: 'Append an internal note', params: idParams, body: noteBody },
  }, async (req) => {
    const body = noteBody.parse(req.body)
    return service.addOrderNote(ctxFromRequest(req), req.params.id, body.note)
  })
}
