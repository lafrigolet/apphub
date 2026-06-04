import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/causes.service.js'

const publicListQuery = z.object({
  appId:    z.string().min(1),
  tenantId: z.string().uuid(),
})

const createBody = z.object({
  code:          z.string().min(1).max(64),
  name:          z.string().min(1).max(256),
  description:   z.string().max(4000).optional().nullable(),
  targetCents:   z.number().int().min(0).optional().nullable(),
  currency:      z.string().length(3).optional(),
  imageObjectId: z.string().uuid().optional().nullable(),
  active:        z.boolean().optional(),
  position:      z.number().int().min(0).optional(),
  startsAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endsAt:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  suggestedAmountsCents: z.array(z.number().int().min(100)).max(12).optional().nullable(),
})

const updateBody = createBody.partial().omit({ code: true })

// Públicas — el form de donación lee la lista de causas activas
// pasando (appId, tenantId) por query.
export async function publicCausesRoutes(fastify) {
  fastify.get(
    '/',
    {
      config: { public: true },
      schema: {
        tags:        ['donations · causes'],
        summary:     'List active causes for the given tenant (public)',
        querystring: publicListQuery,
      },
    },
    async (req) => {
      const { appId, tenantId } = publicListQuery.parse(req.query ?? {})
      return { data: await service.listPublicCauses({ appId, tenantId }) }
    },
  )
}

// Admin — CRUD desde la consola del tenant.
export async function adminCausesRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))

  fastify.get(
    '/',
    { schema: { tags: ['donations · causes admin'], summary: 'List ALL causes (incl. inactive)' } },
    async (req) => ({ data: await service.listAllCauses(req.identity) }),
  )

  fastify.get(
    '/:id',
    { schema: { tags: ['donations · causes admin'], summary: 'Get a cause by id' } },
    async (req) => ({ data: await service.getCauseById(req.identity, req.params.id) }),
  )

  fastify.post(
    '/',
    { schema: { tags: ['donations · causes admin'], summary: 'Create a cause', body: createBody } },
    async (req, reply) => {
      const body = createBody.parse(req.body ?? {})
      const created = await service.createCause(req.identity, body)
      reply.code(201)
      return { data: created }
    },
  )

  fastify.patch(
    '/:id',
    { schema: { tags: ['donations · causes admin'], summary: 'Update a cause', body: updateBody } },
    async (req) => {
      const body = updateBody.parse(req.body ?? {})
      return { data: await service.updateCause(req.identity, req.params.id, body) }
    },
  )

  fastify.delete(
    '/:id',
    { schema: { tags: ['donations · causes admin'], summary: 'Soft-delete a cause (active=false)' } },
    async (req, reply) => {
      await service.deleteCause(req.identity, req.params.id)
      reply.code(204).send()
    },
  )
}
