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
  orderId:       z.string().uuid(),
  carrier:       z.string().max(64).optional(),
  trackingCode:  z.string().max(128).optional(),
  rateId:        z.string().uuid().optional(),
  metadata:      z.record(z.any()).optional(),
})

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

export async function shippingRoutes(fastify) {
  fastify.get('/v1/shipping/zones', async (req) => service.listZones(ctxFromRequest(req)))
  fastify.post('/v1/shipping/zones', async (req, reply) => {
    const z = zoneBody.parse(req.body)
    return reply.status(201).send(await service.createZone(ctxFromRequest(req), z))
  })

  fastify.get('/v1/shipping/rates', async (req) => {
    const zoneId = req.query?.zoneId
    return service.listRates(ctxFromRequest(req), zoneId)
  })
  fastify.post('/v1/shipping/rates', async (req, reply) => {
    const r = rateBody.parse(req.body)
    return reply.status(201).send(await service.createRate(ctxFromRequest(req), r))
  })

  fastify.get('/v1/shipping/quote', async (req) => {
    const q = quoteQuery.parse(req.query)
    return service.quote(ctxFromRequest(req), q)
  })

  fastify.post('/v1/shipping/shipments', async (req, reply) => {
    const s = shipmentBody.parse(req.body)
    return reply.status(201).send(await service.createShipment(ctxFromRequest(req), s))
  })

  fastify.get('/v1/shipping/shipments/:id', async (req) => {
    return service.getShipment(ctxFromRequest(req), req.params.id)
  })

  fastify.post('/v1/shipping/shipments/:id/events', async (req, reply) => {
    const e = eventBody.parse(req.body)
    return reply.status(201).send(await service.appendEvent(ctxFromRequest(req), req.params.id, e))
  })
}
