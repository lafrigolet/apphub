import { z } from 'zod'
import * as service from '../services/dojos.service.js'
import { tenantFromRequest } from '../lib/tenant-ctx.js'

const createBody = z.object({
  name:     z.string().min(1).max(128),
  city:     z.string().min(1).max(128),
  province: z.string().min(1).max(128),
  address:  z.string().max(256).optional(),
  sensei:   z.string().max(256).optional(),
  phone:    z.string().max(64).optional(),
  email:    z.string().email().max(256).optional().or(z.literal('').transform(() => undefined)),
  web:      z.string().max(256).optional(),
})

export async function dojosRoutes(fastify) {
  // Público: tenant se resuelve por Bearer token (admin) o ?tenantId=<uuid>
  // (landing pública).
  fastify.get('/v1/aikikan/dojos', { config: { public: true } }, async (req) => {
    return service.listDojos(tenantFromRequest(req))
  })

  fastify.post('/v1/aikikan/dojos', async (req, reply) => {
    const body = createBody.parse(req.body ?? {})
    const d = await service.createDojo(req.identity, body)
    return reply.status(201).send(d)
  })

  fastify.delete('/v1/aikikan/dojos/:id', async (req, reply) => {
    await service.deleteDojo(req.identity, req.params.id)
    return reply.status(204).send()
  })
}
