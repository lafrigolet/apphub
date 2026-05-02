import { z } from 'zod'
import * as service from '../services/shipping.service.js'

const zoneBody = z.object({
  name:         z.string().min(1).max(128),
  countryCodes: z.array(z.string().length(2)).optional(),
  regionCodes:  z.array(z.string()).optional(),
})

const rateBody = z.object({
  zoneId:       z.string().uuid().optional(),
  name:         z.string().min(1).max(128),
  priceCents:   z.number().int().min(0),
  minWeightG:   z.number().int().min(0).optional(),
  maxWeightG:   z.number().int().min(0).optional(),
  etaDaysMin:   z.number().int().min(0).optional(),
  etaDaysMax:   z.number().int().min(0).optional(),
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

const quoteQuery = z.object({ country: z.string().length(2).optional() })

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

export async function shippingRoutes(fastify) {
  fastify.get('/v1/shipping/zones', { schema: { tags, summary: 'List shipping zones' } },
    async (req) => service.listZones(ctxFromRequest(req)))
  fastify.post('/v1/shipping/zones', { schema: { tags, summary: 'Create a shipping zone', body: zoneBody } },
    async (req, reply) => {
      const z = zoneBody.parse(req.body)
      return reply.status(201).send(await service.createZone(ctxFromRequest(req), z))
    })

  fastify.get('/v1/shipping/rates', { schema: { tags, summary: 'List shipping rates (optionally filtered by zone)' } },
    async (req) => service.listRates(ctxFromRequest(req), req.query?.zoneId))
  fastify.post('/v1/shipping/rates', { schema: { tags, summary: 'Create a shipping rate', body: rateBody } },
    async (req, reply) => {
      const r = rateBody.parse(req.body)
      return reply.status(201).send(await service.createRate(ctxFromRequest(req), r))
    })

  fastify.get('/v1/shipping/quote', { schema: { tags, summary: 'Quote shipping for a destination country' } },
    async (req) => service.quote(ctxFromRequest(req), quoteQuery.parse(req.query)))

  fastify.post('/v1/shipping/shipments', {
    schema: { tags, summary: 'Create a shipment', body: shipmentBody },
  }, async (req, reply) => {
    const s = shipmentBody.parse(req.body)
    return reply.status(201).send(await service.createShipment(ctxFromRequest(req), s))
  })

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
