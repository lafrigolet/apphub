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

const listQuery = z.object({
  kind:        z.string().optional(),
  ownerUserId: z.string().uuid().optional(),
  status:      z.enum(['pending', 'uploaded', 'deleted']).optional(),
  limit:       z.coerce.number().int().min(1).max(500).optional(),
  cursor:      z.string().max(128).optional(),
})

const deleteQuery = z.object({
  // Staff-only physical deletion (GDPR art. 17). Default false = reversible
  // soft-delete.
  hard: z.coerce.boolean().optional(),
})

const idParams = z.object({ id: z.string().min(1) })

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
  fastify.get('/v1/storage/kinds', {
    config: { public: true },
    schema: { tags: ['storage'], summary: 'List allowed object kinds' },
  }, async () => listKinds())

  // POST /v1/storage/uploads — request a presigned PUT
  fastify.post('/v1/storage/uploads', {
    schema: { tags: ['storage'], summary: 'Request a presigned upload URL', body: uploadBody },
  }, async (req, reply) => {
    const body = uploadBody.parse(req.body)
    const r = await service.requestUpload(ctxFromRequest(req), body)
    return reply.status(201).send(r)
  })

  // POST /v1/storage/objects/:id/finalize — confirm bytes landed
  fastify.post('/v1/storage/objects/:id/finalize', {
    schema: { tags: ['storage'], summary: 'Finalize an upload (verify bytes landed)', params: idParams },
  }, async (req) => service.finalize(ctxFromRequest(req), req.params.id))

  // GET /v1/storage/objects/:id — metadata
  fastify.get('/v1/storage/objects/:id', {
    schema: { tags: ['storage'], summary: 'Get object metadata', params: idParams },
  }, async (req) => service.getObject(ctxFromRequest(req), req.params.id))

  // GET /v1/storage/objects/:id/download-url
  fastify.get('/v1/storage/objects/:id/download-url', {
    schema: { tags: ['storage'], summary: 'Get a presigned download URL', params: idParams, querystring: downloadQuery },
  }, async (req) => {
    const { ttl } = downloadQuery.parse(req.query)
    const access = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null }
    return service.getDownloadUrl(ctxFromRequest(req), req.params.id, ttl ?? 300, access)
  })

  // POST /v1/storage/objects/:id/restore — undo a soft-delete
  fastify.post('/v1/storage/objects/:id/restore', {
    schema: { tags: ['storage'], summary: 'Restore a soft-deleted object', params: idParams },
  }, async (req) => service.restoreObject(ctxFromRequest(req), req.params.id))

  // DELETE /v1/storage/objects/:id — soft-delete (or ?hard=true for staff)
  fastify.delete('/v1/storage/objects/:id', {
    schema: { tags: ['storage'], summary: 'Delete an object (soft, or hard for staff)', params: idParams, querystring: deleteQuery },
  }, async (req, reply) => {
    const { hard } = deleteQuery.parse(req.query ?? {})
    if (hard && !['staff', 'super_admin'].includes(req.identity.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'hard delete requires staff' } })
    }
    await service.deleteObject(ctxFromRequest(req), req.params.id, { hard: !!hard })
    return reply.status(204).send()
  })

  // GET /v1/storage/objects (filterable, cursor-paginated list)
  fastify.get('/v1/storage/objects', {
    schema: { tags: ['storage'], summary: 'List objects (filterable, cursor-paginated)', querystring: listQuery },
  }, async (req) => {
    const opts = listQuery.parse(req.query)
    return service.listObjects(ctxFromRequest(req), opts)
  })

  // GET /v1/storage/usage — bytes consumed + quota for the tenant
  fastify.get('/v1/storage/usage', {
    schema: { tags: ['storage'], summary: 'Tenant storage usage and quota' },
  }, async (req) => service.getUsage(ctxFromRequest(req)))
}
