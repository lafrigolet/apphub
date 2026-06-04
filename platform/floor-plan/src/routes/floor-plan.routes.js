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

const sectionPatchBody = z.object({
  name:         z.string().min(1).max(128).optional(),
  description:  z.string().max(512).nullable().optional(),
  isOutdoor:    z.boolean().optional(),
  displayOrder: z.number().int().optional(),
})

const tablePatchBody = z.object({
  sectionId: z.string().uuid().optional(),
  code:      z.string().min(1).max(64).optional(),
  capacity:  z.number().int().positive().optional(),
  shape:     z.enum(['square','round','rectangle','oval']).optional(),
  posX:      z.number().int().nullable().optional(),
  posY:      z.number().int().nullable().optional(),
})

const idParams = z.object({ id: z.string().uuid() })

const eventsQuery = z.object({
  from:     z.coerce.date().optional(),
  to:       z.coerce.date().optional(),
  toStatus: z.enum(['free','reserved','occupied','dirty','out_of_service']).optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(100),
  offset:   z.coerce.number().int().min(0).default(0),
})

const occupancyQuery = z.object({ sectionId: z.string().uuid().optional() })

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

  fastify.patch(
    '/v1/floor-plan/sections/:id',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Update a section',
        params: idParams,
        body: sectionPatchBody,
      },
    },
    async (req) => {
      const body = sectionPatchBody.parse(req.body ?? {})
      return service.updateSection(ctxFromRequest(req), req.params.id, body)
    },
  )

  fastify.delete(
    '/v1/floor-plan/sections/:id',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Delete a section (refused if it still has tables)',
        params: idParams,
      },
    },
    async (req) => service.deleteSection(ctxFromRequest(req), req.params.id),
  )

  fastify.get(
    '/v1/floor-plan/occupancy',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Live occupancy snapshot (capacity, occupied tables, seated guests)',
        querystring: occupancyQuery,
      },
    },
    async (req) => {
      const q = occupancyQuery.parse(req.query ?? {})
      return service.occupancy(ctxFromRequest(req), q)
    },
  )

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

  fastify.patch(
    '/v1/floor-plan/tables/:id',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Update a table (section, code, capacity, shape, position)',
        params: idParams,
        body: tablePatchBody,
      },
    },
    async (req) => {
      const body = tablePatchBody.parse(req.body ?? {})
      return service.updateTable(ctxFromRequest(req), req.params.id, body)
    },
  )

  fastify.delete(
    '/v1/floor-plan/tables/:id',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Delete a table (only when free / out_of_service and not combined)',
        params: idParams,
      },
    },
    async (req) => service.deleteTable(ctxFromRequest(req), req.params.id),
  )

  fastify.get(
    '/v1/floor-plan/tables/:id/events',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Read the state-transition audit log of a table',
        params: idParams,
        querystring: eventsQuery,
      },
    },
    async (req) => {
      const q = eventsQuery.parse(req.query ?? {})
      return service.listTableEvents(ctxFromRequest(req), req.params.id, q)
    },
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

  fastify.post(
    '/v1/floor-plan/tables/:id/split',
    {
      schema: {
        tags: ['floor-plan'],
        summary: 'Separate a combined group: clear the primary and release secondaries',
        params: idParams,
      },
    },
    async (req) => service.splitTables(ctxFromRequest(req), req.params.id),
  )
}
