// Inbound email admin surface (§26, §29) — staff/super_admin only.
//
//   GET    /inbound                    bandeja: list with status/from/to filters
//   GET    /inbound/:id                full email + attachments (+ signed URLs)
//   POST   /inbound/:id/reprocess      dead-letter recovery / re-route
//   POST   /inbound/inject             dev-stub: run the pipeline on a synthetic email
//   DELETE /inbound/by-sender          GDPR erasure: all mail from one address
//   GET    /inbound-routes             list routing rules
//   POST   /inbound-routes             create rule
//   PATCH  /inbound-routes/:id         update rule
//   DELETE /inbound-routes/:id         delete rule
import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import { pool } from '../lib/db.js'
import * as inboundRepo from '../repositories/inbound-emails.repository.js'
import * as routesRepo from '../repositories/inbound-routes.repository.js'
import { reprocess, injectInbound } from '../services/inbound.service.js'
import { deleteStoredObjects, attachmentDownloadUrl } from '../services/inbound-attachments.service.js'

const tags = ['notifications · inbound']

const listQuery = z.object({
  status: z.enum(['received', 'fetched', 'routed', 'unrouted', 'failed', 'quarantined', 'archived']).optional(),
  from:   z.string().email().optional(),
  to:     z.string().email().optional(),
  limit:  z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

const idParams = z.object({ id: z.string().uuid() })

const injectBody = z.object({
  from:    z.string().min(3).max(512),
  to:      z.array(z.string().min(3).max(512)).min(1),
  subject: z.string().max(998).optional().nullable(),
  text:    z.string().max(200_000).optional().nullable(),
  html:    z.string().max(500_000).optional().nullable(),
  headers: z.record(z.string()).optional(),
  messageId: z.string().max(998).optional().nullable(),
  attachments: z.array(z.object({
    filename:      z.string().max(255),
    contentType:   z.string().max(255),
    contentBase64: z.string().max(20_000_000),
  })).optional(),
})

const senderQuery = z.object({ email: z.string().email() })

const routeBody = z.object({
  matchType:   z.enum(['exact', 'domain']).optional(),
  pattern:     z.string().min(3).max(512),
  targetEvent: z.string().min(3).max(128),
  appId:       z.string().max(64).optional().nullable(),
  tenantId:    z.string().uuid().optional().nullable(),
  enabled:     z.boolean().optional(),
  description: z.string().max(512).optional().nullable(),
})

const routePatch = routeBody.partial()

export async function inboundAdminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  // ── Bandeja ───────────────────────────────────────────────────────────
  fastify.get('/inbound', {
    schema: { tags, summary: 'List inbound emails (staff inbox)', querystring: listQuery },
  }, async (req) => {
    const q = listQuery.parse(req.query ?? {})
    const client = await pool.connect()
    try {
      const data = await inboundRepo.list(client, {
        status: q.status, fromAddress: q.from, toAddress: q.to, limit: q.limit, offset: q.offset,
      })
      return { data }
    } finally { client.release() }
  })

  fastify.get('/inbound/:id', {
    schema: { tags, summary: 'Get one inbound email with attachments (+ signed download URLs)', params: idParams },
  }, async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const client = await pool.connect()
    try {
      const email = await inboundRepo.findById(client, id)
      if (!email) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'inbound email not found' } })
      const attachments = await inboundRepo.listAttachments(client, id)
      const withUrls = await Promise.all(attachments.map(async (a) => ({
        ...a, download_url: a.status === 'stored' ? await attachmentDownloadUrl(a) : null,
      })))
      return { data: { ...email, attachments: withUrls } }
    } finally { client.release() }
  })

  fastify.post('/inbound/:id/reprocess', {
    schema: { tags, summary: 'Reset and re-run the pipeline on one inbound email', params: idParams },
  }, async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const result = await reprocess(id)
    if (!result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'inbound email not found' } })
    return { data: result }
  })

  // Dev-stub (§23): exercise routing/consumers without Resend or DNS.
  fastify.post('/inbound/inject', {
    schema: { tags, summary: 'Inject a synthetic inbound email through the full pipeline (dev/test)', body: injectBody },
  }, async (req, reply) => {
    const body = injectBody.parse(req.body ?? {})
    const result = await injectInbound(body)
    return reply.code(201).send({ data: result })
  })

  // GDPR erasure (§29): rows cascade; stored objects are deleted best-effort.
  fastify.delete('/inbound/by-sender', {
    schema: { tags, summary: 'Delete every inbound email (and attachments) from one sender — GDPR', querystring: senderQuery },
  }, async (req) => {
    const { email } = senderQuery.parse(req.query ?? {})
    const client = await pool.connect()
    let out
    try {
      out = await inboundRepo.deleteBySender(client, email)
    } finally { client.release() }
    const objectsDeleted = await deleteStoredObjects(out.objectKeys)
    return { data: { deleted: out.deleted, objectsDeleted } }
  })

  // ── Routing rules ─────────────────────────────────────────────────────
  fastify.get('/inbound-routes', {
    schema: { tags, summary: 'List inbound routing rules' },
  }, async () => {
    const client = await pool.connect()
    try { return { data: await routesRepo.listAll(client) } } finally { client.release() }
  })

  fastify.post('/inbound-routes', {
    schema: { tags, summary: 'Create an inbound routing rule (address/domain → event)', body: routeBody },
  }, async (req, reply) => {
    const body = routeBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      const row = await routesRepo.insert(client, body)
      return reply.code(201).send({ data: row })
    } finally { client.release() }
  })

  fastify.patch('/inbound-routes/:id', {
    schema: { tags, summary: 'Update an inbound routing rule', params: idParams, body: routePatch },
  }, async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const body = routePatch.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      const row = await routesRepo.update(client, id, body)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } })
      return { data: row }
    } finally { client.release() }
  })

  fastify.delete('/inbound-routes/:id', {
    schema: { tags, summary: 'Delete an inbound routing rule', params: idParams },
  }, async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const client = await pool.connect()
    try {
      const ok = await routesRepo.remove(client, id)
      if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } })
      return { data: { deleted: true } }
    } finally { client.release() }
  })
}
