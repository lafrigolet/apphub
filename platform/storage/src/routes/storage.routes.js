import { z } from 'zod'
import * as service from '../services/storage.service.js'
import { listKinds } from '../kinds.js'

const uploadBody = z.object({
  kind:        z.string().min(1).max(64),
  contentType: z.string().min(1).max(128),
  sizeBytes:   z.number().int().positive(),
  filename:    z.string().max(256).optional(),
  metadata:    z.record(z.any()).optional(),
})

const downloadQuery = z.object({
  ttl: z.coerce.number().int().min(30).max(3600).optional(),
})

const publicDownloadQuery = z.object({
  appId:    z.string().min(1).max(64),
  tenantId: z.string().uuid(),
})

const listQuery = z.object({
  kind:        z.string().optional(),
  ownerUserId: z.string().uuid().optional(),
  status:      z.enum(['pending', 'uploaded', 'deleted']).optional(),
  limit:       z.coerce.number().int().min(1).max(500).optional(),
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

export async function storageRoutes(fastify) {
  // Public: list of allowed kinds (frontends use this to know what they can upload).
  fastify.get('/v1/storage/kinds', { config: { public: true } }, async () => listKinds())

  // GET /v1/storage/public/:id — anonymous download for kinds with
  // `public: true` (landing downloadables). 302 → presigned GET so nginx
  // never proxies the bytes. appId/tenantId travel in the query (the
  // object UUID is unguessable; RLS still applies inside the service).
  fastify.get(
    '/v1/storage/public/:id',
    {
      config: {
        public: true,
        // Endpoint público sin auth — mismo criterio anti-abuso que los
        // POST públicos de leads/inquiries, con margen para descargas.
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['storage'],
        summary: 'Redirect to a presigned GET for a public-kind object',
        querystring: publicDownloadQuery,
      },
    },
    async (req, reply) => {
      const ctx = publicDownloadQuery.parse(req.query)
      const { downloadUrl } = await service.getPublicDownloadUrl(ctx, req.params.id)
      return reply.redirect(downloadUrl, 302)
    },
  )

  // POST /v1/storage/uploads — request a presigned PUT
  fastify.post('/v1/storage/uploads', async (req, reply) => {
    const body = uploadBody.parse(req.body)
    const r = await service.requestUpload(ctxFromRequest(req), body)
    return reply.status(201).send(r)
  })

  // POST /v1/storage/objects/:id/finalize — confirm bytes landed
  fastify.post('/v1/storage/objects/:id/finalize', async (req) =>
    service.finalize(ctxFromRequest(req), req.params.id),
  )

  // GET /v1/storage/objects/:id — metadata
  fastify.get('/v1/storage/objects/:id', async (req) =>
    service.getObject(ctxFromRequest(req), req.params.id),
  )

  // GET /v1/storage/objects/:id/download-url
  fastify.get('/v1/storage/objects/:id/download-url', async (req) => {
    const { ttl } = downloadQuery.parse(req.query)
    return service.getDownloadUrl(ctxFromRequest(req), req.params.id, ttl ?? 300)
  })

  // DELETE /v1/storage/objects/:id — soft-delete
  fastify.delete('/v1/storage/objects/:id', async (req, reply) => {
    await service.deleteObject(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })

  // GET /v1/storage/objects (filterable list)
  fastify.get('/v1/storage/objects', async (req) => {
    const opts = listQuery.parse(req.query)
    return service.listObjects(ctxFromRequest(req), opts)
  })
}
