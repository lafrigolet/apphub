import { z } from 'zod'
import * as service from '../services/certificates.service.js'

// Admin emite el certificado tras pre-subir el PDF a platform/storage.
// El cliente del admin habrá hecho:
//   1. POST /v1/storage/uploads { kind: 'aikikan_certificate', contentType: 'application/pdf', sizeBytes }
//   2. PUT al uploadUrl que devolvió el paso 1 con los bytes del PDF
//   3. POST /v1/storage/objects/:id/finalize
//   4. POST /v1/aikikan/certificates con file_object_id
const issueBody = z.object({
  userId:       z.string().uuid(),
  kind:         z.enum(['grade', 'attendance']),
  title:        z.string().min(1).max(256),
  fileObjectId: z.string().uuid(),
  gradeValue:   z.string().max(32).optional(),
  eventId:      z.string().uuid().optional(),
  issuedAt:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:        z.string().max(1024).optional(),
})

export async function certificatesRoutes(fastify) {
  // Listado del socio actual.
  fastify.get('/v1/aikikan/certificates/me', async (req) => {
    return service.listMine(req.identity)
  })

  // Pide un download URL temporal (presigned). Reenviamos el bearer
  // token a platform/storage para que aplique su propio guard.
  fastify.get('/v1/aikikan/certificates/:id/download-url', async (req) => {
    const auth   = req.headers.authorization ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
    return service.getDownloadUrl(req.identity, bearer, req.params.id)
  })

  // Admin: emitir certificado.
  fastify.post('/v1/aikikan/certificates', async (req, reply) => {
    const body = issueBody.parse(req.body ?? {})
    const c = await service.issue(req.identity, body)
    return reply.status(201).send(c)
  })

  // Admin: revocar (soft-delete).
  fastify.delete('/v1/aikikan/certificates/:id', async (req, reply) => {
    await service.revoke(req.identity, req.params.id)
    return reply.status(204).send()
  })
}
