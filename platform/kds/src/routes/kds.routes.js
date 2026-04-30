import { z } from 'zod'
import * as service from '../services/kds.service.js'

const stationBody = z.object({
  name:          z.string().min(1).max(64),
  displayOrder:  z.number().int().optional(),
  routesCourses: z.array(z.string()).optional(),
  isActive:      z.boolean().optional(),
})

const bumpBody = z.object({
  status: z.enum(['in_progress','ready','picked_up','cancelled']),
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

export async function kdsRoutes(fastify) {
  fastify.post('/v1/kds/stations', async (req, reply) => {
    const body = stationBody.parse(req.body)
    return reply.status(201).send(await service.createStation(ctxFromRequest(req), body))
  })

  fastify.get('/v1/kds/stations', async (req) => service.listStations(ctxFromRequest(req)))

  fastify.get('/v1/kds/tickets', async (req) =>
    service.listTickets(ctxFromRequest(req), {
      stationId: req.query?.stationId,
      status:    req.query?.status,
      limit:     req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )

  fastify.get('/v1/kds/tickets/:id', async (req) =>
    service.getTicket(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/kds/tickets/:id/status', async (req) => {
    const body = bumpBody.parse(req.body)
    return service.bumpTicket(ctxFromRequest(req), req.params.id, body.status)
  })
}
