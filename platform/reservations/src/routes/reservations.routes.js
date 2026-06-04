import { z } from 'zod'
import * as service from '../services/reservations.service.js'

// Structured special requests (allergens, high chair, accessibility, occasion,
// seating preference). Free-text `notes` stays for anything not modelled here.
const specialRequests = z.object({
  allergens:     z.array(z.string().max(64)).max(32).optional(),
  highChair:     z.boolean().optional(),
  wheelchair:    z.boolean().optional(),
  seatingPref:   z.enum(['terrace','indoor','window','quiet','accessible']).optional(),
  occasion:      z.enum(['birthday','anniversary','business','first_date','other']).optional(),
  dietaryNotes:  z.string().max(512).optional(),
}).strict()

const reservationBody = z.object({
  guestName:        z.string().min(1).max(128),
  guestEmail:       z.string().email().optional(),
  guestPhone:       z.string().max(32).optional(),
  partySize:        z.number().int().positive(),
  reservedFor:      z.string().datetime(),
  durationMinutes:  z.number().int().positive().optional(),
  tableId:          z.string().uuid().optional(),
  notes:            z.string().max(512).optional(),
  source:           z.enum(['portal','phone','walk_in','partner']).optional(),
  // Optional preferred locale for reminder notifications. When null, the
  // scheduler falls back to the tenant's default_locale and finally to 'es'.
  locale:           z.string().min(2).max(8).optional(),
  specialRequests:  specialRequests.optional(),
})

const statusBody = z.object({
  status:             z.enum(['confirmed','seated','completed','cancelled','no_show']),
  tableId:            z.string().uuid().optional(),
  // Only consumed on cancelled transitions.
  cancelledBy:        z.enum(['guest','staff','system']).optional(),
  cancellationReason: z.string().max(512).optional(),
})

const waitlistBody = z.object({
  guestName:             z.string().min(1).max(128),
  guestPhone:            z.string().max(32).optional(),
  partySize:             z.number().int().positive(),
  estimatedWaitMinutes:  z.number().int().min(0).optional(),
  notes:                 z.string().max(512).optional(),
})

const serviceHoursBody = z.object({
  dayOfWeek:    z.number().int().min(0).max(6),
  openMinute:   z.number().int().min(0).max(1439),
  closeMinute:  z.number().int().min(0).max(1440),
  serviceLabel: z.string().max(64).optional(),
  isClosed:     z.boolean().optional(),
  // Per-window seating capacity; null/absent → unlimited.
  maxCovers:    z.number().int().positive().optional(),
})

const idParams        = z.object({ id: z.string().min(1) })
const listQuery       = z.object({
  from:   z.string().optional(),
  to:     z.string().optional(),
  status: z.enum(['requested','confirmed','seated','completed','cancelled','no_show']).optional(),
  limit:  z.coerce.number().int().positive().max(500).optional(),
})
const waitlistQuery   = z.object({
  status: z.enum(['waiting','notified','seated','left','cancelled']).optional(),
})
const availabilityQuery = z.object({
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  partySize: z.coerce.number().int().positive().optional(),
})
const noShowQuery = z.object({
  guestUserId: z.string().uuid().optional(),
  guestEmail:  z.string().email().optional(),
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

const tags = ['reservations']

export async function reservationsRoutes(fastify) {
  fastify.post('/v1/reservations', {
    schema: { tags, summary: 'Create a reservation (validates service hours + capacity unless walk-in)', body: reservationBody },
  }, async (req, reply) => {
    return reply.status(201).send(await service.createReservation(ctxFromRequest(req), req.body))
  })

  fastify.get('/v1/reservations', {
    schema: { tags, summary: 'List reservations filtered by window/status', querystring: listQuery },
  }, async (req) => {
    return service.listReservations(ctxFromRequest(req), {
      from:   req.query?.from,
      to:     req.query?.to,
      status: req.query?.status,
      limit:  req.query?.limit,
    })
  })

  // Availability for a calendar date + party size (open windows + covers left).
  fastify.get('/v1/reservations/availability', {
    schema: { tags, summary: 'Service windows + remaining covers for a date', querystring: availabilityQuery },
  }, async (req) => {
    return service.checkAvailability(ctxFromRequest(req), {
      date: req.query.date, partySize: req.query?.partySize,
    })
  })

  // Past no-show count for a guest (by user id when authenticated, else email).
  fastify.get('/v1/reservations/no-shows', {
    schema: { tags, summary: 'Count past no-shows for a guest (by userId or email)', querystring: noShowQuery },
  }, async (req) => {
    return service.getGuestNoShowCount(ctxFromRequest(req), {
      guestUserId: req.query?.guestUserId, guestEmail: req.query?.guestEmail,
    })
  })

  fastify.get('/v1/reservations/:id', {
    schema: { tags, summary: 'Fetch one reservation', params: idParams },
  }, async (req) => service.getReservation(ctxFromRequest(req), req.params.id))

  fastify.patch('/v1/reservations/:id/status', {
    schema: { tags, summary: 'Advance reservation FSM; cancel records reason/actor', params: idParams, body: statusBody },
  }, async (req) => {
    const { status, tableId, cancelledBy, cancellationReason } = req.body
    return service.changeStatus(ctxFromRequest(req), req.params.id, status, tableId, { cancelledBy, cancellationReason })
  })

  // Waitlist
  fastify.post('/v1/reservations/waitlist', {
    schema: { tags: ['reservations · waitlist'], summary: 'Add a guest to the waitlist', body: waitlistBody },
  }, async (req, reply) => {
    return reply.status(201).send(await service.addToWaitlist(ctxFromRequest(req), req.body))
  })

  fastify.get('/v1/reservations/waitlist', {
    schema: { tags: ['reservations · waitlist'], summary: 'List waitlist entries by status', querystring: waitlistQuery },
  }, async (req) => service.listWaitlist(ctxFromRequest(req), { status: req.query?.status }))

  fastify.post('/v1/reservations/waitlist/:id/notify', {
    schema: { tags: ['reservations · waitlist'], summary: 'Manually notify a waiting guest', params: idParams },
  }, async (req) => service.notifyWaitlist(ctxFromRequest(req), req.params.id))

  // Service hours
  fastify.post('/v1/reservations/service-hours', {
    schema: { tags: ['reservations · service-hours'], summary: 'Define a service window (with optional capacity)', body: serviceHoursBody },
  }, async (req, reply) => {
    return reply.status(201).send(await service.createServiceHours(ctxFromRequest(req), req.body))
  })

  fastify.get('/v1/reservations/service-hours', {
    schema: { tags: ['reservations · service-hours'], summary: 'List configured service windows' },
  }, async (req) => service.listServiceHours(ctxFromRequest(req)))
}
