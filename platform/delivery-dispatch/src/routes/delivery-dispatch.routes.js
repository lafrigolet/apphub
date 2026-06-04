import { z } from 'zod'
import * as service from '../services/delivery-dispatch.service.js'
import { PROVIDERS } from '../services/carriers.js'

const tags = ['delivery-dispatch']

const zoneBody = z.object({
  name:           z.string().min(1).max(128),
  polygon:        z.any(), // GeoJSON polygon
  baseFeeCents:   z.number().int().min(0).optional(),
  perKmCents:     z.number().int().min(0).optional(),
  minOrderCents:  z.number().int().min(0).optional(),
  isActive:       z.boolean().optional(),
})

const zonePatchBody = z.object({
  name:           z.string().min(1).max(128).optional(),
  polygon:        z.any().optional(),
  baseFeeCents:   z.number().int().min(0).optional(),
  perKmCents:     z.number().int().min(0).optional(),
  minOrderCents:  z.number().int().min(0).optional(),
  isActive:       z.boolean().optional(),
})

const quoteQuery = z.object({
  lat:             z.coerce.number(),
  lng:             z.coerce.number(),
  orderTotalCents: z.coerce.number().int().min(0).optional(),
})

const riderBody = z.object({
  userId:      z.string().uuid().optional(),
  displayName: z.string().min(1).max(128),
  phone:       z.string().max(32).optional(),
  vehicle:     z.enum(['bike','ebike','scooter','car','foot']).optional(),
  status:      z.enum(['offline','available','assigned','en_route','returning']).optional(),
})

const riderPatchBody = z.object({
  userId:      z.string().uuid().optional(),
  displayName: z.string().min(1).max(128).optional(),
  phone:       z.string().max(32).optional(),
  vehicle:     z.enum(['bike','ebike','scooter','car','foot']).optional(),
  status:      z.enum(['offline','available','assigned','en_route','returning']).optional(),
})

const riderDeleteBody = z.object({
  reason: z.string().max(512).optional(),
})

const riderPingBody = z.object({
  lat:    z.number(),
  lng:    z.number(),
  status: z.enum(['offline','available','assigned','en_route','returning']).optional(),
})

const addressSchema = z.object({
  fullName:    z.string().max(128).optional(),
  line1:       z.string().max(256),
  line2:       z.string().max(256).optional(),
  city:        z.string().max(128).optional(),
  postalCode:  z.string().max(32).optional(),
  country:     z.string().length(2).optional(),
  phone:       z.string().max(32).optional(),
  lat:         z.number().optional(),
  lng:         z.number().optional(),
})

const deliveryBody = z.object({
  orderId:          z.string().uuid(),
  carrier:          z.enum(['own','glovo','uber','justeat','deliveroo','other']).optional(),
  externalRef:      z.string().max(256).optional(),
  zoneId:           z.string().uuid().optional(),
  pickupAddress:    addressSchema.optional(),
  dropAddress:      addressSchema,
  feeCents:         z.number().int().min(0).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
})

const assignBody = z.object({ riderId: z.string().uuid() })

const statusBody = z.object({
  status:  z.enum(['picked_up','delivered','cancelled','failed']),
  lat:     z.number().optional(),
  lng:     z.number().optional(),
  reason:  z.string().max(512).optional(),
})

const idParams = z.object({ id: z.string().uuid() })
const providerParams = z.object({ provider: z.enum(PROVIDERS) })

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function deliveryDispatchRoutes(fastify) {
  // Preserve the raw request body for carrier-webhook HMAC verification.
  // Scoped to this plugin only — does not affect the rest of platform-core.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, bodyString, done) => {
      req.rawBody = bodyString
      try {
        done(null, bodyString.length ? JSON.parse(bodyString) : {})
      } catch (err) {
        err.statusCode = 400
        done(err, undefined)
      }
    },
  )

  // Zones
  fastify.post('/v1/delivery-dispatch/zones', {
    schema: { tags, summary: 'Create a delivery zone (GeoJSON polygon + fees)', body: zoneBody },
  }, async (req, reply) => {
    const body = zoneBody.parse(req.body)
    return reply.status(201).send(await service.createZone(ctxFromRequest(req), body))
  })

  fastify.get('/v1/delivery-dispatch/zones', {
    schema: { tags, summary: 'List delivery zones for the tenant' },
  }, async (req) => service.listZones(ctxFromRequest(req)))

  fastify.patch('/v1/delivery-dispatch/zones/:id', {
    schema: { tags, summary: 'Update a delivery zone', params: idParams, body: zonePatchBody },
  }, async (req) => {
    const { id } = idParams.parse(req.params)
    const body = zonePatchBody.parse(req.body)
    return service.updateZone(ctxFromRequest(req), id, body)
  })

  fastify.delete('/v1/delivery-dispatch/zones/:id', {
    schema: { tags, summary: 'Delete a delivery zone', params: idParams },
  }, async (req) => {
    const { id } = idParams.parse(req.params)
    return service.deleteZone(ctxFromRequest(req), id)
  })

  // Quote — fee preview before checkout (resolves zone by point-in-polygon).
  fastify.get('/v1/delivery-dispatch/quote', {
    schema: { tags, summary: 'Quote delivery fee for a drop point', querystring: quoteQuery },
  }, async (req) => {
    const q = quoteQuery.parse(req.query)
    return service.quote(ctxFromRequest(req), q)
  })

  // Riders
  fastify.post('/v1/delivery-dispatch/riders', {
    schema: { tags, summary: 'Register a rider', body: riderBody },
  }, async (req, reply) => {
    const body = riderBody.parse(req.body)
    return reply.status(201).send(await service.createRider(ctxFromRequest(req), body))
  })

  fastify.get('/v1/delivery-dispatch/riders', {
    schema: { tags, summary: 'List riders (optionally filtered by status)',
      querystring: z.object({ status: z.string().optional() }) },
  }, async (req) =>
    service.listRiders(ctxFromRequest(req), { status: req.query?.status }),
  )

  fastify.patch('/v1/delivery-dispatch/riders/:id', {
    schema: { tags, summary: 'Update a rider profile', params: idParams, body: riderPatchBody },
  }, async (req) => {
    const { id } = idParams.parse(req.params)
    const body = riderPatchBody.parse(req.body)
    return service.updateRider(ctxFromRequest(req), id, body)
  })

  fastify.delete('/v1/delivery-dispatch/riders/:id', {
    schema: { tags, summary: 'Deactivate (soft-delete) a rider; optional {reason}', params: idParams },
  }, async (req) => {
    const { id } = idParams.parse(req.params)
    const body = riderDeleteBody.parse(req.body ?? {})
    return service.deactivateRider(ctxFromRequest(req), id, body.reason)
  })

  fastify.post('/v1/delivery-dispatch/riders/:id/ping', {
    schema: { tags, summary: 'Rider GPS ping (updates last position + status)', params: idParams, body: riderPingBody },
  }, async (req) => {
    const body = riderPingBody.parse(req.body)
    return service.pingRiderLocation(ctxFromRequest(req), req.params.id, body)
  })

  // Deliveries
  fastify.post('/v1/delivery-dispatch/deliveries', {
    schema: { tags, summary: 'Create a delivery', body: deliveryBody },
  }, async (req, reply) => {
    const body = deliveryBody.parse(req.body)
    return reply.status(201).send(await service.createDelivery(ctxFromRequest(req), body))
  })

  fastify.get('/v1/delivery-dispatch/deliveries', {
    schema: { tags, summary: 'List deliveries (filter by status/rider)',
      querystring: z.object({ status: z.string().optional(), riderId: z.string().optional(), limit: z.string().optional() }) },
  }, async (req) =>
    service.listDeliveries(ctxFromRequest(req), {
      status:  req.query?.status,
      riderId: req.query?.riderId,
      limit:   req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )

  fastify.get('/v1/delivery-dispatch/deliveries/:id', {
    schema: { tags, summary: 'Get a delivery with its event log', params: idParams },
  }, async (req) =>
    service.getDelivery(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/delivery-dispatch/deliveries/:id/assign', {
    schema: { tags, summary: 'Assign a rider to a pending delivery', params: idParams, body: assignBody },
  }, async (req) => {
    const body = assignBody.parse(req.body)
    return service.assignRider(ctxFromRequest(req), req.params.id, body.riderId)
  })

  fastify.patch('/v1/delivery-dispatch/deliveries/:id/status', {
    schema: { tags, summary: 'Transition a delivery to a new FSM status', params: idParams, body: statusBody },
  }, async (req) => {
    const body = statusBody.parse(req.body)
    const { status, ...meta } = body
    return service.changeStatus(ctxFromRequest(req), req.params.id, status, meta)
  })

  // Inbound aggregator webhook (Uber/Glovo/Stuart). Public: no JWT — verified
  // by per-provider HMAC over the raw body. app/tenant/externalRef come from
  // the payload itself.
  fastify.post('/v1/delivery-dispatch/webhooks/:provider', {
    config: { public: true },
    schema: {
      tags,
      summary: 'Inbound carrier status webhook (HMAC-verified, auto-transitions FSM)',
      params: providerParams,
    },
  }, async (req, reply) => {
    const { provider } = providerParams.parse(req.params)
    const signature = req.headers['x-webhook-signature'] ?? req.headers['x-signature']
    const result = await service.handleCarrierWebhook(provider, {
      rawBody: req.rawBody ?? JSON.stringify(req.body ?? {}),
      signature,
      body: req.body ?? {},
    })
    return reply.status(result.matched ? 200 : 202).send(result)
  })
}
