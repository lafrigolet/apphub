import { z } from 'zod'
import * as service from '../services/events.service.js'

const createBody = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  name:     z.string().min(1).max(256),
  location: z.string().max(256).optional(),
})

export async function eventsRoutes(fastify) {
  fastify.get('/v1/aikikan/events', { config: { public: true } }, async () => {
    return service.listEvents()
  })

  fastify.post('/v1/aikikan/events', async (req, reply) => {
    const body = createBody.parse(req.body ?? {})
    const ev = await service.createEvent(req.identity, body)
    return reply.status(201).send(ev)
  })

  fastify.delete('/v1/aikikan/events/:id', async (req, reply) => {
    await service.deleteEvent(req.identity, req.params.id)
    return reply.status(204).send()
  })
}
