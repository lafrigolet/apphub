import { z } from 'zod'
import * as service from '../services/delivery-dispatch.service.js'

const zoneBody = z.object({
  name:           z.string().min(1).max(128),
  polygon:        z.any(), // GeoJSON polygon
  baseFeeCents:   z.number().int().min(0).optional(),
  perKmCents:     z.number().int().min(0).optional(),
  minOrderCents:  z.number().int().min(0).optional(),
  isActive:       z.boolean().optional(),
})

const riderBody = z.object({
  userId:      z.string().uuid().optional(),
  displayName: z.string().min(1).max(128),
  phone:       z.string().max(32).optional(),
  vehicle:     z.enum(['bike','ebike','scooter','car','foot']).optional(),
  status:      z.enum(['offline','available','assigned','en_route','returning']).optional(),
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
  // Zones
  fastify.post('/v1/delivery-dispatch/zones', async (req, reply) => {
    const body = zoneBody.parse(req.body)
    return reply.status(201).send(await service.createZone(ctxFromRequest(req), body))
  })
  fastify.get('/v1/delivery-dispatch/zones', async (req) => service.listZones(ctxFromRequest(req)))

  // Riders
  fastify.post('/v1/delivery-dispatch/riders', async (req, reply) => {
    const body = riderBody.parse(req.body)
    return reply.status(201).send(await service.createRider(ctxFromRequest(req), body))
  })
  fastify.get('/v1/delivery-dispatch/riders', async (req) =>
    service.listRiders(ctxFromRequest(req), { status: req.query?.status }),
  )
  fastify.post('/v1/delivery-dispatch/riders/:id/ping', async (req) => {
    const body = riderPingBody.parse(req.body)
    return service.pingRiderLocation(ctxFromRequest(req), req.params.id, body)
  })

  // Deliveries
  fastify.post('/v1/delivery-dispatch/deliveries', async (req, reply) => {
    const body = deliveryBody.parse(req.body)
    return reply.status(201).send(await service.createDelivery(ctxFromRequest(req), body))
  })
  fastify.get('/v1/delivery-dispatch/deliveries', async (req) =>
    service.listDeliveries(ctxFromRequest(req), {
      status:  req.query?.status,
      riderId: req.query?.riderId,
      limit:   req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )
  fastify.get('/v1/delivery-dispatch/deliveries/:id', async (req) =>
    service.getDelivery(ctxFromRequest(req), req.params.id),
  )
  fastify.post('/v1/delivery-dispatch/deliveries/:id/assign', async (req) => {
    const body = assignBody.parse(req.body)
    return service.assignRider(ctxFromRequest(req), req.params.id, body.riderId)
  })
  fastify.patch('/v1/delivery-dispatch/deliveries/:id/status', async (req) => {
    const body = statusBody.parse(req.body)
    const { status, ...meta } = body
    return service.changeStatus(ctxFromRequest(req), req.params.id, status, meta)
  })
}
