import { z } from 'zod'
import * as service from '../services/bookings.service.js'

const bookingBody = z.object({
  serviceId:        z.string().uuid(),
  resourceIds:      z.array(z.string().uuid()).min(1),
  // Optional id returned by POST /v1/availability/holds. When present, the
  // hold is atomically consumed inside the booking transaction; if it has
  // expired or doesn't match the booking window the request fails 409.
  holdId:           z.string().uuid().optional(),
  clientUserId:     z.string().uuid().optional(),
  clientName:       z.string().max(256).optional(),
  clientEmail:      z.string().email().optional(),
  clientPhone:      z.string().max(32).optional(),
  startsAt:         z.string().datetime(),
  endsAt:           z.string().datetime(),
  notes:            z.string().max(2048).optional(),
  internalNotes:    z.string().max(2048).optional(),
  recurrenceId:     z.string().uuid().optional(),
  parentBookingId:  z.string().uuid().optional(),
  packageId:        z.string().uuid().optional(),
  priceCents:       z.number().int().min(0).optional(),
  currency:         z.string().length(3).optional(),
  source:           z.enum(['portal','phone','staff','partner','recurrence']).optional(),
  metadata:         z.record(z.any()).optional(),
})

const statusBody = z.object({
  status: z.enum(['confirmed','reminded','checked_in','in_progress','completed','cancelled','no_show']),
  reason: z.string().max(512).optional(),
})

const rescheduleBody = z.object({
  startsAt: z.string().datetime(),
  endsAt:   z.string().datetime(),
  reason:   z.string().max(512).optional(),
})

const waitlistBody = z.object({
  serviceId:       z.string().uuid(),
  resourceId:      z.string().uuid().optional(),
  clientUserId:    z.string().uuid().optional(),
  clientName:      z.string().max(256).optional(),
  clientPhone:     z.string().max(32).optional(),
  preferredWindow: z.record(z.any()).optional(),
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

const tags         = ['bookings']
const waitlistTags = ['bookings · waitlist']
const cancelBody   = z.object({ reason: z.string().max(512).optional() })
const idParams     = z.object({ id: z.string().uuid() })

export async function bookingsRoutes(fastify) {
  fastify.post('/v1/bookings', {
    schema: {
      tags,
      summary: 'Create a booking (optionally consuming an availability hold)',
      body: bookingBody,
    },
  }, async (req, reply) => {
    const body = bookingBody.parse(req.body)
    return reply.status(201).send(await service.createBooking(ctxFromRequest(req), body))
  })

  fastify.get('/v1/bookings', {
    schema: { tags, summary: 'List bookings (filterable by window/resource/client/status)' },
  }, async (req) =>
    service.listBookings(ctxFromRequest(req), {
      from: req.query?.from, to: req.query?.to,
      clientUserId: req.query?.clientUserId,
      resourceId:   req.query?.resourceId,
      status:       req.query?.status,
      limit:        req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )

  fastify.get('/v1/bookings/:id', {
    schema: { tags, summary: 'Get one booking with its resources and event log', params: idParams },
  }, async (req) =>
    service.getBooking(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/bookings/:id/status', {
    schema: { tags, summary: 'Change booking status (FSM-validated)', params: idParams, body: statusBody },
  }, async (req) => {
    const body = statusBody.parse(req.body)
    return service.changeStatus(ctxFromRequest(req), req.params.id, body.status, body.reason)
  })

  fastify.post('/v1/bookings/:id/cancel', {
    schema: { tags, summary: 'Cancel a booking', params: idParams, body: cancelBody },
  }, async (req) => {
    const body = cancelBody.parse(req.body)
    return service.cancelBooking(ctxFromRequest(req), req.params.id, body.reason)
  })

  fastify.post('/v1/bookings/:id/reschedule', {
    schema: { tags, summary: 'Reschedule a booking to a new window', params: idParams, body: rescheduleBody },
  }, async (req) => {
    const body = rescheduleBody.parse(req.body)
    return service.reschedule(ctxFromRequest(req), req.params.id, body)
  })

  // Waitlist
  fastify.post('/v1/bookings/waitlist', {
    schema: { tags: waitlistTags, summary: 'Enqueue a client on the service waitlist', body: waitlistBody },
  }, async (req, reply) => {
    const body = waitlistBody.parse(req.body)
    return reply.status(201).send(await service.addToWaitlist(ctxFromRequest(req), body))
  })

  fastify.get('/v1/bookings/waitlist', {
    schema: { tags: waitlistTags, summary: 'List waitlist entries' },
  }, async (req) =>
    service.listWaitlist(ctxFromRequest(req), {
      serviceId: req.query?.serviceId,
      status:    req.query?.status,
    }),
  )

  fastify.post('/v1/bookings/waitlist/:id/notify', {
    schema: { tags: waitlistTags, summary: 'Mark a waitlist entry as notified', params: idParams },
  }, async (req) =>
    service.notifyWaitlist(ctxFromRequest(req), req.params.id),
  )
}
