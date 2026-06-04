import { z } from 'zod'
import * as service from '../services/kds.service.js'

const stationBody = z.object({
  name:          z.string().min(1).max(64),
  displayOrder:  z.number().int().optional(),
  routesCourses: z.array(z.string()).optional(),
  isActive:      z.boolean().optional(),
})

const stationPatchBody = z.object({
  name:          z.string().min(1).max(64).optional(),
  displayOrder:  z.number().int().optional(),
  routesCourses: z.array(z.string()).optional(),
  isActive:      z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'at least one field required' })

const bumpBody = z.object({
  status: z.enum(['in_progress','ready','picked_up','cancelled']),
  reason: z.string().max(512).optional(),
})

const orderBumpBody = z.object({
  status: z.enum(['in_progress','ready','picked_up','cancelled']),
  reason: z.string().max(512).optional(),
})

const itemBumpBody = z.object({
  status: z.enum(['in_progress','ready']),
})

const deleteStationBody = z.object({
  reassignTo: z.string().uuid().nullable().optional(),
}).nullish()

const idParams      = z.object({ id: z.string().uuid() })
const orderParams   = z.object({ orderId: z.string().uuid() })
const itemParams    = z.object({ itemId: z.string().uuid() })

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

const tags = ['kds']

export async function kdsRoutes(fastify) {
  // ── Stations ────────────────────────────────────────────────────────────
  fastify.post('/v1/kds/stations', {
    schema: { tags, summary: 'Create a kitchen station', body: stationBody },
  }, async (req, reply) => {
    const body = stationBody.parse(req.body)
    return reply.status(201).send(await service.createStation(ctxFromRequest(req), body))
  })

  fastify.get('/v1/kds/stations', {
    schema: { tags, summary: 'List stations ordered by display_order, name' },
  }, async (req) => service.listStations(ctxFromRequest(req)))

  fastify.patch('/v1/kds/stations/:id', {
    schema: { tags, summary: 'Update a station (name, order, routed courses, active flag)', params: idParams, body: stationPatchBody },
  }, async (req) => {
    const body = stationPatchBody.parse(req.body)
    return service.updateStation(ctxFromRequest(req), req.params.id, body)
  })

  fastify.delete('/v1/kds/stations/:id', {
    schema: { tags, summary: 'Delete a station, reassigning its open tickets (to reassignTo or to unrouted)', params: idParams, body: deleteStationBody },
  }, async (req) => {
    const body = deleteStationBody.parse(req.body ?? {}) ?? {}
    return service.deleteStation(ctxFromRequest(req), req.params.id, { reassignTo: body.reassignTo ?? null })
  })

  // ── Tickets ─────────────────────────────────────────────────────────────
  fastify.get('/v1/kds/tickets', {
    schema: { tags, summary: 'List tickets (filterable by station/status), each with its items' },
  }, async (req) =>
    service.listTickets(ctxFromRequest(req), {
      stationId: req.query?.stationId,
      status:    req.query?.status,
      limit:     req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )

  fastify.get('/v1/kds/tickets/:id', {
    schema: { tags, summary: 'Get one ticket with its items', params: idParams },
  }, async (req) => service.getTicket(ctxFromRequest(req), req.params.id))

  fastify.patch('/v1/kds/tickets/:id/status', {
    schema: { tags, summary: 'Bump a ticket to a new status (FSM-validated)', params: idParams, body: bumpBody },
  }, async (req) => {
    const body = bumpBody.parse(req.body)
    return service.bumpTicket(ctxFromRequest(req), req.params.id, body.status, body.reason ?? null)
  })

  fastify.post('/v1/kds/tickets/:id/bump', {
    schema: { tags, summary: 'One-touch bump: advance the ticket to the next FSM state', params: idParams },
  }, async (req) => service.advanceTicket(ctxFromRequest(req), req.params.id))

  fastify.patch('/v1/kds/items/:itemId/status', {
    schema: { tags, summary: 'Partial bump: set an individual line item status', params: itemParams, body: itemBumpBody },
  }, async (req) => {
    const body = itemBumpBody.parse(req.body)
    return service.bumpItem(ctxFromRequest(req), req.params.itemId, body.status)
  })

  // ── Orders (multi-ticket grouping) ────────────────────────────────────────
  fastify.get('/v1/kds/orders/:orderId/tickets', {
    schema: { tags, summary: 'All tickets of an order grouped, with derived aggregate status', params: orderParams },
  }, async (req) => service.listTicketsByOrder(ctxFromRequest(req), req.params.orderId))

  fastify.patch('/v1/kds/orders/:orderId/bump', {
    schema: { tags, summary: 'Mass bump every eligible ticket of an order to a status', params: orderParams, body: orderBumpBody },
  }, async (req) => {
    const body = orderBumpBody.parse(req.body)
    return service.bumpOrderTickets(ctxFromRequest(req), req.params.orderId, body.status, body.reason ?? null)
  })

  // ── Aggregates ────────────────────────────────────────────────────────────
  fastify.get('/v1/kds/allday', {
    schema: { tags, summary: 'All-day totals: SUM(qty) per (sku,name) of active tickets' },
  }, async (req) => service.allDay(ctxFromRequest(req), { stationId: req.query?.stationId }))

  fastify.get('/v1/kds/metrics', {
    schema: { tags, summary: 'Kitchen timing metrics (ack/prep/pickup avgs, cancellations) by station+course' },
  }, async (req) => service.metrics(ctxFromRequest(req), { from: req.query?.from, to: req.query?.to }))
}
