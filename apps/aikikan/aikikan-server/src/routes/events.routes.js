import { z } from 'zod'
import * as service from '../services/events.service.js'
import * as regs    from '../services/event-registrations.service.js'

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

  // ── Inscripciones del socio ─────────────────────────────────────────
  // Listar las inscripciones del socio actual (con datos del evento
  // embebidos para ahorrar un round-trip al frontend).
  fastify.get('/v1/aikikan/events/me', async (req) => {
    return regs.listMine(req.identity)
  })

  // Auto-inscribirse a un evento. Idempotente — re-inscribirse tras
  // cancelar reactiva la fila. 409 si el evento es pasado.
  fastify.post('/v1/aikikan/events/:id/register', async (req, reply) => {
    const r = await regs.register(req.identity, req.params.id)
    return reply.status(201).send(r)
  })

  // Cancelar la propia inscripción. 404 si no estaba inscrito.
  fastify.delete('/v1/aikikan/events/:id/register', async (req) => {
    return regs.cancel(req.identity, req.params.id)
  })

  // ── Admin ───────────────────────────────────────────────────────────
  // Listar inscripciones de un evento (gestión de asistencia).
  fastify.get('/v1/aikikan/events/:id/registrations', async (req) => {
    return regs.listForEvent(req.identity, req.params.id)
  })

  // Marcar asistencia (post-evento). El registrationId se pasa como param.
  fastify.post('/v1/aikikan/events/registrations/:regId/attended', async (req) => {
    return regs.markAttended(req.identity, req.params.regId)
  })
}
