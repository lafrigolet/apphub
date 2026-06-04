import { z } from 'zod'
import * as service from '../services/shipping.service.js'
import * as returnsService from '../services/returns.service.js'

const zoneBody = z.object({
  name:         z.string().min(1).max(128),
  countryCodes: z.array(z.string().length(2)).optional(),
  regionCodes:  z.array(z.string()).optional(),
})

const serviceLevelEnum = z.enum(['economy', 'standard', 'express', 'overnight', 'in_store_pickup'])

const rateBody = z.object({
  zoneId:         z.string().uuid().optional(),
  name:           z.string().min(1).max(128),
  priceCents:     z.number().int().min(0),
  minWeightG:     z.number().int().min(0).optional(),
  maxWeightG:     z.number().int().min(0).optional(),
  etaDaysMin:     z.number().int().min(0).optional(),
  etaDaysMax:     z.number().int().min(0).optional(),
  freeAboveCents: z.number().int().min(0).optional(),
  serviceLevel:   serviceLevelEnum.optional(),
  active:         z.boolean().optional(),
})

const zonePatchBody = z.object({
  name:         z.string().min(1).max(128).optional(),
  countryCodes: z.array(z.string().length(2)).optional(),
  regionCodes:  z.array(z.string()).optional(),
})

const ratePatchBody = z.object({
  zoneId:         z.string().uuid().nullable().optional(),
  name:           z.string().min(1).max(128).optional(),
  priceCents:     z.number().int().min(0).optional(),
  minWeightG:     z.number().int().min(0).optional(),
  maxWeightG:     z.number().int().min(0).nullable().optional(),
  etaDaysMin:     z.number().int().min(0).nullable().optional(),
  etaDaysMax:     z.number().int().min(0).nullable().optional(),
  freeAboveCents: z.number().int().min(0).nullable().optional(),
  serviceLevel:   serviceLevelEnum.optional(),
  active:         z.boolean().optional(),
})

const shipmentBody = z.object({
  orderId:                z.string().uuid(),
  carrier:                z.string().max(64).optional(),
  trackingCode:           z.string().max(128).optional(),
  rateId:                 z.string().uuid().optional(),
  metadata:               z.record(z.any()).optional(),
  insuranceAmountCents:   z.number().int().min(0).optional(),
  insuranceCurrency:      z.string().length(3).optional(),
  signatureRequired:      z.boolean().optional(),
})

const packageBody = z.object({
  packageNumber: z.number().int().min(1).optional(),
  carrier:       z.string().max(64).optional(),
  trackingCode:  z.string().max(128).optional(),
  weightGrams:   z.number().int().min(0).optional(),
  lengthMm:      z.number().int().min(0).optional(),
  widthMm:       z.number().int().min(0).optional(),
  heightMm:      z.number().int().min(0).optional(),
  metadata:      z.record(z.any()).optional(),
})

const idParams       = z.object({ id: z.string().uuid() })
const carrierParams  = z.object({ carrier: z.enum(['ups', 'fedex', 'dhl', 'easypost']) })

const eventBody = z.object({
  code:        z.string().min(1).max(64),
  description: z.string().max(512).optional(),
  location:    z.string().max(256).optional(),
})

const quoteQuery = z.object({
  country:         z.string().length(2).optional(),
  weightG:         z.coerce.number().int().min(0).optional(),
  orderValueCents: z.coerce.number().int().min(0).optional(),
})

const shipmentListQuery = z.object({
  status:       z.string().max(32).optional(),
  carrier:      z.string().max(64).optional(),
  orderId:      z.string().uuid().optional(),
  createdSince: z.string().datetime().optional(),
  limit:        z.coerce.number().int().min(1).max(200).optional(),
})

function ctxFromRequest(req) {
  return {
    appId: req.identity.appId,
    tenantId: req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId: req.identity.userId,
  }
}

const tags        = ['shipping']
const pkgTags     = ['shipping · packages']
const webhookTags = ['shipping · webhooks']
const returnTags  = ['shipping · returns']

const returnItemBody = z.object({
  sku:            z.string().min(1).max(128),
  qty:            z.number().int().positive(),
  reason:         z.string().max(256).optional(),
  condition:      z.enum(['new', 'open_box', 'used', 'damaged', 'missing']).optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  metadata:       z.record(z.any()).optional(),
})

const createReturnBody = z.object({
  orderId: z.string().uuid(),
  reason:  z.string().max(2000).optional(),
  items:   z.array(returnItemBody).min(1),
})

const decisionBody     = z.object({ notes: z.string().max(2000).optional() })
const issueLabelBody   = z.object({
  carrier:           z.string().max(64).optional(),
  trackingCode:      z.string().max(128).optional(),
  inboundShipmentId: z.string().uuid().optional(),
})
const markShippedBody  = z.object({ trackingCode: z.string().max(128).optional() })
const receiveBody      = z.object({
  items: z.array(z.object({
    id:          z.string().uuid(),
    qtyReceived: z.number().int().min(0).optional(),
    condition:   z.enum(['new', 'open_box', 'used', 'damaged', 'missing']).optional(),
  })).optional(),
})
const refundReturnBody = z.object({
  amountCents: z.number().int().positive(),
  currency:    z.string().length(3).optional(),
})
const cancelReturnBody = z.object({ reason: z.string().max(2000).optional() })

const returnIdParams   = z.object({ id: z.string().uuid() })

export async function shippingRoutes(fastify) {
  fastify.get('/v1/shipping/zones', { schema: { tags, summary: 'List shipping zones' } },
    async (req) => service.listZones(ctxFromRequest(req)))
  fastify.post('/v1/shipping/zones', { schema: { tags, summary: 'Create a shipping zone', body: zoneBody } },
    async (req, reply) => {
      const z = zoneBody.parse(req.body)
      return reply.status(201).send(await service.createZone(ctxFromRequest(req), z))
    })
  fastify.patch('/v1/shipping/zones/:id', {
    schema: { tags, summary: 'Update a shipping zone', params: idParams, body: zonePatchBody },
  }, async (req) => {
    const body = zonePatchBody.parse(req.body ?? {})
    return service.updateZone(ctxFromRequest(req), req.params.id, body)
  })
  fastify.delete('/v1/shipping/zones/:id', {
    schema: { tags, summary: 'Delete a shipping zone', params: idParams },
  }, async (req) => service.deleteZone(ctxFromRequest(req), req.params.id))

  fastify.get('/v1/shipping/rates', { schema: { tags, summary: 'List shipping rates (optionally filtered by zone)' } },
    async (req) => service.listRates(ctxFromRequest(req), req.query?.zoneId))
  fastify.post('/v1/shipping/rates', { schema: { tags, summary: 'Create a shipping rate', body: rateBody } },
    async (req, reply) => {
      const r = rateBody.parse(req.body)
      return reply.status(201).send(await service.createRate(ctxFromRequest(req), r))
    })
  fastify.patch('/v1/shipping/rates/:id', {
    schema: { tags, summary: 'Update a shipping rate (price, weight band, ETA, free-shipping threshold, active flag)', params: idParams, body: ratePatchBody },
  }, async (req) => {
    const body = ratePatchBody.parse(req.body ?? {})
    return service.updateRate(ctxFromRequest(req), req.params.id, body)
  })
  fastify.delete('/v1/shipping/rates/:id', {
    schema: { tags, summary: 'Delete a shipping rate', params: idParams },
  }, async (req) => service.deleteRate(ctxFromRequest(req), req.params.id))

  fastify.get('/v1/shipping/quote', {
    schema: { tags, summary: 'Quote shipping for a destination (country + cart weight + order value)', querystring: quoteQuery },
  }, async (req) => service.quote(ctxFromRequest(req), quoteQuery.parse(req.query)))

  fastify.post('/v1/shipping/shipments', {
    schema: { tags, summary: 'Create a shipment', body: shipmentBody },
  }, async (req, reply) => {
    const s = shipmentBody.parse(req.body)
    return reply.status(201).send(await service.createShipment(ctxFromRequest(req), s))
  })

  fastify.get('/v1/shipping/shipments', {
    schema: { tags, summary: 'List shipments (filter by status / carrier / orderId / createdSince)', querystring: shipmentListQuery },
  }, async (req) => ({ data: await service.listShipments(ctxFromRequest(req), shipmentListQuery.parse(req.query ?? {})) }))

  fastify.get('/v1/shipping/shipments/:id', {
    schema: { tags, summary: 'Get a shipment with its event log', params: idParams },
  }, async (req) => service.getShipment(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/shipping/shipments/:id/events', {
    schema: { tags, summary: 'Append a tracking event (drives FSM)', params: idParams, body: eventBody },
  }, async (req, reply) => {
    const e = eventBody.parse(req.body)
    return reply.status(201).send(await service.appendEvent(ctxFromRequest(req), req.params.id, e))
  })

  // ── Multi-package ────────────────────────────────────────────────────
  fastify.get('/v1/shipping/shipments/:id/packages', {
    schema: { tags: pkgTags, summary: 'List packages of a shipment', params: idParams },
  }, async (req) => ({ data: await service.listPackages(ctxFromRequest(req), req.params.id) }))

  fastify.post('/v1/shipping/shipments/:id/packages', {
    schema: {
      tags: pkgTags,
      summary: 'Add a package to a shipment (auto-numbered when packageNumber is omitted)',
      params: idParams, body: packageBody,
    },
  }, async (req, reply) => {
    const body = packageBody.parse(req.body)
    return reply.status(201).send(await service.addPackage(ctxFromRequest(req), req.params.id, body))
  })

  // ── Carrier webhook receivers ────────────────────────────────────────
  // Public — no JWT (carriers don't have one). Authentication is via the
  // carrier's signature header verified inside the service.
  fastify.post('/v1/shipping/webhooks/:carrier', {
    schema: { tags: webhookTags, summary: 'Carrier tracking webhook (UPS/FedEx/DHL/EasyPost)', params: carrierParams },
    config: { public: true },
    // Capture the raw body so HMAC verification has the bytes the carrier signed.
    bodyLimit: 1024 * 1024,
  }, async (req, reply) => {
    const { carrier } = carrierParams.parse(req.params)
    const rawBody         = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    const payload         = typeof req.body === 'string' ? safeJson(req.body) : req.body
    const signatureHeader = req.headers['x-hmac-signature']
                         ?? req.headers['x-dhl-signature']
                         ?? req.headers['x-fedex-signature']
                         ?? req.headers['x-ups-signature']
    const r = await service.ingestCarrierWebhook(carrier, { rawBody, payload, signatureHeader })
    if (r.duplicate) return reply.status(200).send({ duplicate: true })
    return reply.status(202).send(r)
  })
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return {} }
}

// ── Returns / RMA ──────────────────────────────────────────────────────
// Mounted alongside the rest of the shipping routes; the wrapper is just
// a separate function to keep returns code coherent.
export async function returnsRoutes(fastify) {
  fastify.post('/v1/shipping/returns', {
    schema: { tags: returnTags, summary: 'Open a return request for an order', body: createReturnBody },
  }, async (req, reply) => {
    const body = createReturnBody.parse(req.body)
    const r = await returnsService.createReturn(ctxFromRequest(req), body)
    return reply.status(201).send(r)
  })

  fastify.get('/v1/shipping/returns', {
    schema: { tags: returnTags, summary: 'List returns (filterable by status / orderId / buyerUserId)' },
  }, async (req) => {
    return { data: await returnsService.listReturns(ctxFromRequest(req), {
      status:      req.query?.status,
      orderId:     req.query?.orderId,
      buyerUserId: req.query?.buyerUserId,
      limit:       req.query?.limit ? Number(req.query.limit) : undefined,
    }) }
  })

  fastify.get('/v1/shipping/returns/:id', {
    schema: { tags: returnTags, summary: 'Get a return with its line items', params: returnIdParams },
  }, async (req) => returnsService.getReturn(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/shipping/returns/:id/approve', {
    schema: { tags: returnTags, summary: 'Approve a return (staff/admin)', params: returnIdParams, body: decisionBody },
  }, async (req) => {
    const body = decisionBody.parse(req.body ?? {})
    return returnsService.approveReturn(ctxFromRequest(req), req.params.id, body.notes)
  })

  fastify.post('/v1/shipping/returns/:id/reject', {
    schema: { tags: returnTags, summary: 'Reject a return (staff/admin)', params: returnIdParams, body: decisionBody },
  }, async (req) => {
    const body = decisionBody.parse(req.body ?? {})
    return returnsService.rejectReturn(ctxFromRequest(req), req.params.id, body.notes)
  })

  fastify.post('/v1/shipping/returns/:id/cancel', {
    schema: { tags: returnTags, summary: 'Cancel a return (buyer or staff)', params: returnIdParams, body: cancelReturnBody },
  }, async (req) => {
    const body = cancelReturnBody.parse(req.body ?? {})
    return returnsService.cancelReturn(ctxFromRequest(req), req.params.id, body.reason)
  })

  fastify.post('/v1/shipping/returns/:id/issue-label', {
    schema: { tags: returnTags, summary: 'Issue a return label (carrier+trackingCode optional, persisted on the return)', params: returnIdParams, body: issueLabelBody },
  }, async (req) => {
    const body = issueLabelBody.parse(req.body ?? {})
    return returnsService.issueReturnLabel(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/shipping/returns/:id/shipped', {
    schema: { tags: returnTags, summary: 'Mark a return as shipped by the buyer', params: returnIdParams, body: markShippedBody },
  }, async (req) => {
    const body = markShippedBody.parse(req.body ?? {})
    return returnsService.markShipped(ctxFromRequest(req), req.params.id, body.trackingCode)
  })

  fastify.post('/v1/shipping/returns/:id/receive', {
    schema: { tags: returnTags, summary: 'Mark return received in the warehouse (per-line qtyReceived + condition)', params: returnIdParams, body: receiveBody },
  }, async (req) => {
    const body = receiveBody.parse(req.body ?? {})
    return returnsService.receiveReturn(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/shipping/returns/:id/restock', {
    schema: { tags: returnTags, summary: 'Restock the new/open_box items (publishes inventory.restock.requested)', params: returnIdParams },
  }, async (req) => returnsService.restockReturn(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/shipping/returns/:id/refund', {
    schema: { tags: returnTags, summary: 'Issue a refund for the return (publishes return.refund.requested for splitpay)', params: returnIdParams, body: refundReturnBody },
  }, async (req) => {
    const body = refundReturnBody.parse(req.body)
    return returnsService.refundReturn(ctxFromRequest(req), req.params.id, body)
  })
}
