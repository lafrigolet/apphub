import { z } from 'zod'
import * as service from '../services/videos.service.js'
import { tenantFromRequest } from '../lib/tenant-ctx.js'

// Acepta ID corto de YouTube (11 chars) o URL completa; el cliente
// extrae el id antes de POST. Aquí validamos longitud razonable.
const createBody = z.object({
  youtubeId: z.string().min(6).max(64),
  label:     z.string().max(64).optional(),
  name:      z.string().min(1).max(256),
})

export async function videosRoutes(fastify) {
  // Público: tenant se resuelve por Bearer token (admin) o ?tenantId=<uuid>
  // (landing pública).
  fastify.get('/v1/aikikan/videos', { config: { public: true } }, async (req) => {
    return service.listVideos(tenantFromRequest(req))
  })

  fastify.post('/v1/aikikan/videos', async (req, reply) => {
    const body = createBody.parse(req.body ?? {})
    const v = await service.createVideo(req.identity, body)
    return reply.status(201).send(v)
  })

  fastify.delete('/v1/aikikan/videos/:id', async (req, reply) => {
    await service.deleteVideo(req.identity, req.params.id)
    return reply.status(204).send()
  })
}
