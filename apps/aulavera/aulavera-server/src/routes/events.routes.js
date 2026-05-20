import { z } from 'zod'
import * as service from '../services/events.service.js'
import { tenantFromRequest } from '../lib/tenant-ctx.js'

const querySchema = z.object({
  kind:     z.enum(['workshop', 'chronicle']).optional(),
  status:   z.enum(['active', 'archived']).optional().default('active'),
  tenantId: z.string().uuid().optional(),
})

export async function eventsRoutes(fastify) {
  // Público — la landing del portal lo consume sin token (resuelve tenant
  // por ?tenantId=<uuid>).
  fastify.get('/v1/aulavera/events', { config: { public: true } }, async (req) => {
    const { kind, status } = querySchema.parse(req.query ?? {})
    return service.listEvents(tenantFromRequest(req), { kind, status })
  })

  fastify.get('/v1/aulavera/events/:id', { config: { public: true } }, async (req, reply) => {
    const id = String(req.params.id)
    const event = await service.getEvent(tenantFromRequest(req), id)
    if (!event) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Event not found' } })
    return event
  })
}
