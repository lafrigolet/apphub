import { z } from 'zod'
import * as service from '../services/reservations.service.js'

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
})

const statusBody = z.object({
  status:  z.enum(['confirmed','seated','completed','cancelled','no_show']),
  tableId: z.string().uuid().optional(),
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

export async function reservationsRoutes(fastify) {
  fastify.post('/v1/reservations', async (req, reply) => {
    const body = reservationBody.parse(req.body)
    return reply.status(201).send(await service.createReservation(ctxFromRequest(req), body))
  })

  fastify.get('/v1/reservations', async (req) => {
    return service.listReservations(ctxFromRequest(req), {
      from:   req.query?.from,
      to:     req.query?.to,
      status: req.query?.status,
      limit:  req.query?.limit ? Number(req.query.limit) : undefined,
    })
  })

  fastify.get('/v1/reservations/:id', async (req) =>
    service.getReservation(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/reservations/:id/status', async (req) => {
    const body = statusBody.parse(req.body)
    return service.changeStatus(ctxFromRequest(req), req.params.id, body.status, body.tableId)
  })

  // Waitlist
  fastify.post('/v1/reservations/waitlist', async (req, reply) => {
    const body = waitlistBody.parse(req.body)
    return reply.status(201).send(await service.addToWaitlist(ctxFromRequest(req), body))
  })

  fastify.get('/v1/reservations/waitlist', async (req) =>
    service.listWaitlist(ctxFromRequest(req), { status: req.query?.status }),
  )

  fastify.post('/v1/reservations/waitlist/:id/notify', async (req) =>
    service.notifyWaitlist(ctxFromRequest(req), req.params.id),
  )

  // Service hours
  fastify.post('/v1/reservations/service-hours', async (req, reply) => {
    const body = serviceHoursBody.parse(req.body)
    return reply.status(201).send(await service.createServiceHours(ctxFromRequest(req), body))
  })

  fastify.get('/v1/reservations/service-hours', async (req) =>
    service.listServiceHours(ctxFromRequest(req)),
  )
}
