import { z } from 'zod'
import * as service from '../services/floor-plan.service.js'

const sectionBody = z.object({
  name:         z.string().min(1).max(128),
  description:  z.string().max(512).optional(),
  isOutdoor:    z.boolean().optional(),
  displayOrder: z.number().int().optional(),
})

const tableBody = z.object({
  sectionId: z.string().uuid(),
  code:      z.string().min(1).max(64),
  capacity:  z.number().int().positive(),
  shape:     z.enum(['square','round','rectangle','oval']).optional(),
  posX:      z.number().int().optional(),
  posY:      z.number().int().optional(),
})

const statusBody = z.object({
  status:        z.enum(['free','reserved','occupied','dirty','out_of_service']),
  reservationId: z.string().uuid().optional(),
  partySize:     z.number().int().positive().optional(),
})

const combineBody = z.object({ otherIds: z.array(z.string().uuid()).min(1) })

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function floorPlanRoutes(fastify) {
  fastify.post('/v1/floor-plan/sections', async (req, reply) => {
    const body = sectionBody.parse(req.body)
    return reply.status(201).send(await service.createSection(ctxFromRequest(req), body))
  })

  fastify.get('/v1/floor-plan/sections', async (req) => service.listSections(ctxFromRequest(req)))

  fastify.post('/v1/floor-plan/tables', async (req, reply) => {
    const body = tableBody.parse(req.body)
    return reply.status(201).send(await service.createTable(ctxFromRequest(req), body))
  })

  fastify.get('/v1/floor-plan/tables', async (req) => {
    return service.listTables(ctxFromRequest(req), {
      sectionId: req.query?.sectionId,
      status:    req.query?.status,
    })
  })

  fastify.get('/v1/floor-plan/tables/:id', async (req) =>
    service.getTable(ctxFromRequest(req), req.params.id),
  )

  fastify.patch('/v1/floor-plan/tables/:id/status', async (req) => {
    const body = statusBody.parse(req.body)
    const { status, ...meta } = body
    return service.changeTableStatus(ctxFromRequest(req), req.params.id, status, meta)
  })

  fastify.post('/v1/floor-plan/tables/:id/combine', async (req) => {
    const body = combineBody.parse(req.body)
    return service.combineTables(ctxFromRequest(req), req.params.id, body.otherIds)
  })
}
