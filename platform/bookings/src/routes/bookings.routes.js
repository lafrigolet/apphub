import { z } from 'zod'
import * as service from '../services/bookings.service.js'

const bookingBody = z.object({
  serviceId:        z.string().uuid(),
  resourceIds:      z.array(z.string().uuid()).min(1),
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

export async function bookingsRoutes(fastify) {
  fastify.post('/v1/bookings', async (req, reply) => {
    const body = bookingBody.parse(req.body)
    return reply.status(201).send(await service.createBooking(ctxFromRequest(req), body))
  })

  fastify.get('/v1/bookings', async (req) =>
    service.listBookings(ctxFromRequest(req), {
      from: req.query?.from, to: req.query?.to,
      clientUserId: req.query?.clientUserId,
      resourceId:   req.query?.resourceId,
      status:       req.query?.status,
      limit:        req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )

  fastify.get('/v1/bookings/:id', async (req) =>
    service.getBooking(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/bookings/:id/status', async (req) => {
    const body = statusBody.parse(req.body)
    return service.changeStatus(ctxFromRequest(req), req.params.id, body.status, body.reason)
  })

  fastify.post('/v1/bookings/:id/cancel', async (req) => {
    const body = z.object({ reason: z.string().max(512).optional() }).parse(req.body)
    return service.cancelBooking(ctxFromRequest(req), req.params.id, body.reason)
  })

  fastify.post('/v1/bookings/:id/reschedule', async (req) => {
    const body = rescheduleBody.parse(req.body)
    return service.reschedule(ctxFromRequest(req), req.params.id, body)
  })

  // Waitlist
  fastify.post('/v1/bookings/waitlist', async (req, reply) => {
    const body = waitlistBody.parse(req.body)
    return reply.status(201).send(await service.addToWaitlist(ctxFromRequest(req), body))
  })

  fastify.get('/v1/bookings/waitlist', async (req) =>
    service.listWaitlist(ctxFromRequest(req), {
      serviceId: req.query?.serviceId,
      status:    req.query?.status,
    }),
  )

  fastify.post('/v1/bookings/waitlist/:id/notify', async (req) =>
    service.notifyWaitlist(ctxFromRequest(req), req.params.id),
  )
}
