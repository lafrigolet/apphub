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
  fastify.post('/v1/orders', async (req, reply) => {
    const body = createBody.parse(req.body)
    const order = await service.createOrder(ctxFromRequest(req), body)
    return reply.status(201).send(order)
  })

  fastify.get('/v1/orders', async (req) => {
    const buyerUserId = req.query?.buyerUserId
    const status      = req.query?.status
    const limit       = req.query?.limit  ? Number(req.query.limit)  : undefined
    const offset      = req.query?.offset ? Number(req.query.offset) : undefined
    return service.listOrders(ctxFromRequest(req), { buyerUserId, status, limit, offset })
  })

  fastify.get('/v1/orders/:id', async (req) => {
    return service.getOrder(ctxFromRequest(req), req.params.id)
  })

  fastify.patch('/v1/orders/:id/status', async (req) => {
    const body = statusBody.parse(req.body)
    return service.changeStatus(ctxFromRequest(req), req.params.id, body.status, body.reason)
  })

  fastify.post('/v1/orders/:id/cancel', async (req) => {
    const body = cancelBody.parse(req.body)
    return service.cancelOrder(ctxFromRequest(req), req.params.id, body.reason)
  })

  fastify.post('/v1/orders/:id/refund', async (req) => {
    const body = cancelBody.parse(req.body)
    return service.refundOrder(ctxFromRequest(req), req.params.id, body.reason)
  })
}
