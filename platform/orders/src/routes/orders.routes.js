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

const addItemBody = itemSchema.extend({ reason: z.string().max(512).optional() })

const qtyBody = z.object({
  qty:    z.number().int().positive(),
  reason: z.string().max(512).optional(),
})

const removeItemBody = z.object({ reason: z.string().max(512).optional() })

const listQuery = z.object({
  buyerUserId:    z.string().optional(),
  status:         z.string().optional(),
  vendorTenantId: z.string().uuid().optional(),
  createdAfter:   z.string().datetime().optional(),
  createdBefore:  z.string().datetime().optional(),
  totalMinCents:  z.coerce.number().int().min(0).optional(),
  totalMaxCents:  z.coerce.number().int().min(0).optional(),
  limit:          z.coerce.number().int().positive().max(500).optional(),
  offset:         z.coerce.number().int().min(0).optional(),
})

const exportQuery = z.object({
  buyerUserId:    z.string().optional(),
  status:         z.string().optional(),
  vendorTenantId: z.string().uuid().optional(),
  createdAfter:   z.string().datetime().optional(),
  createdBefore:  z.string().datetime().optional(),
  totalMinCents:  z.coerce.number().int().min(0).optional(),
  totalMaxCents:  z.coerce.number().int().min(0).optional(),
})

const idParams = z.object({ id: z.string().uuid() })

const itemParams = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })

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
    schema: {
      tags,
      summary: 'List orders (filter by buyer, status, vendor, date range, amount range)',
      querystring: listQuery,
    },
  }, async (req) => {
    const q = listQuery.parse(req.query ?? {})
    return service.listOrders(ctxFromRequest(req), {
      buyerUserId:    q.buyerUserId,
      status:         q.status,
      vendorTenantId: q.vendorTenantId,
      createdAfter:   q.createdAfter,
      createdBefore:  q.createdBefore,
      totalMinCents:  q.totalMinCents,
      totalMaxCents:  q.totalMaxCents,
      limit:          q.limit,
      offset:         q.offset,
    })
  })

  fastify.get('/v1/orders/export.csv', {
    schema: {
      tags: ['orders · reporting'],
      summary: 'Export filtered orders as CSV (date/amount/vendor/status filters)',
      querystring: exportQuery,
    },
  }, async (req, reply) => {
    const q = exportQuery.parse(req.query ?? {})
    const csv = await service.exportOrdersCsv(ctxFromRequest(req), q)
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="orders.csv"')
      .send(csv)
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

  // ── Post-creation item editing (only while pending/paid) ───────────────
  fastify.post('/v1/orders/:id/items', {
    schema: {
      tags: ['orders · modifications'],
      summary: 'Add a line item to an order and recompute totals',
      params: idParams, body: addItemBody,
    },
  }, async (req, reply) => {
    const body = addItemBody.parse(req.body)
    const { reason, ...item } = body
    const result = await service.addItem(ctxFromRequest(req), req.params.id, item, reason)
    return reply.status(201).send(result)
  })

  fastify.patch('/v1/orders/:id/items/:itemId', {
    schema: {
      tags: ['orders · modifications'],
      summary: 'Change the quantity of a line item and recompute totals',
      params: itemParams, body: qtyBody,
    },
  }, async (req) => {
    const body = qtyBody.parse(req.body)
    return service.changeItemQty(ctxFromRequest(req), req.params.id, req.params.itemId, body.qty, body.reason)
  })

  fastify.delete('/v1/orders/:id/items/:itemId', {
    schema: {
      tags: ['orders · modifications'],
      summary: 'Remove a line item from an order and recompute totals',
      params: itemParams, body: removeItemBody,
    },
  }, async (req) => {
    const body = removeItemBody.parse(req.body ?? {})
    return service.removeItem(ctxFromRequest(req), req.params.id, req.params.itemId, body.reason)
  })
}
