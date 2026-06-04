import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/settings.repository.js'
import { pool } from '../lib/db.js'
import { loadSettings, invalidate as invalidateSettings } from '../lib/settings.js'
import { configureClient, testConnectivity, setQuota, getUsage, listAccessLog, purgeExpired, notifyExpiringSoon } from '../services/storage.service.js'
import { getKind, KINDS } from '../kinds.js'

const quotaBody = z.object({
  maxBytes: z.number().int().min(0),
})

const accessLogQuery = z.object({
  objectId: z.string().uuid().optional(),
  limit:    z.coerce.number().int().min(1).max(500).optional(),
  cursor:   z.string().max(128).optional(),
})

const purgeBody = z.object({
  limit: z.number().int().min(1).max(2000).optional(),
})

const expiringBody = z.object({
  windowDays: z.number().int().min(1).max(3650).optional(),
  limit:      z.number().int().min(1).max(5000).optional(),
})

function ctxFromIdentity(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

const patchBody = z.object({
  s3_endpoint:         z.string().url().optional().nullable(),
  s3_public_endpoint:  z.string().url().optional().nullable(),
  s3_region:           z.string().min(1).max(64).optional().nullable(),
  s3_bucket:           z.string().min(1).max(128).optional().nullable(),
  s3_access_key:       z.string().min(1).max(2048).optional().nullable(),
  s3_secret_key:       z.string().min(1).max(2048).optional().nullable(),
  s3_force_path_style: z.union([z.boolean(), z.string()]).optional().nullable(),
})

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  fastify.get('/config', async () => {
    const client = await pool.connect()
    try { return { data: await repo.listForAdmin(client) } } finally { client.release() }
  })

  fastify.patch('/config', async (req) => {
    const body = patchBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        const v = key === 's3_force_path_style' ? String(!!value) : value
        await repo.upsertValue(client, key, v)
      }
      // Drop the cached client so the next request rebuilds it with the
      // freshly-saved credentials.
      configureClient(null)
      invalidateSettings()
      await loadSettings()
      // Best-effort connectivity probe so a broken endpoint/creds combo is
      // surfaced immediately rather than failing silently on the next upload.
      // We report the result but don't reject the PATCH (avoids lockout if the
      // bucket is temporarily unreachable).
      let connectivity
      try { connectivity = await testConnectivity() }
      catch (err) { connectivity = { ok: false, error: err.message } }
      return { data: await repo.listForAdmin(client), connectivity }
    } finally { client.release() }
  })

  // Explicit connectivity probe (HEAD bucket) against the live settings.
  fastify.post('/config/test', {
    schema: { tags: ['storage-admin'], summary: 'Probe S3 connectivity (HEAD bucket)' },
  }, async (req, reply) => {
    try { return await testConnectivity() }
    catch (err) { return reply.status(err.statusCode ?? 502).send({ error: { code: err.code ?? 'STORAGE_UNREACHABLE', message: err.message } }) }
  })

  // Tenant storage quota (bytes). GET returns usage + quota; PUT sets it.
  fastify.get('/quota', {
    schema: { tags: ['storage-admin'], summary: 'Get tenant storage usage and quota' },
  }, async (req) => getUsage(ctxFromIdentity(req)))

  fastify.put('/quota', {
    schema: { tags: ['storage-admin'], summary: 'Set tenant storage quota (bytes)', body: quotaBody },
  }, async (req) => {
    const { maxBytes } = quotaBody.parse(req.body ?? {})
    return setQuota(ctxFromIdentity(req), maxBytes)
  })

  // Download audit log (compliance): who fetched which object, when, from where.
  fastify.get('/access-log', {
    schema: { tags: ['storage-admin'], summary: 'List download access log (cursor-paginated)', querystring: accessLogQuery },
  }, async (req) => {
    const opts = accessLogQuery.parse(req.query ?? {})
    return listAccessLog(ctxFromIdentity(req), opts)
  })

  // Retention: hard-delete every object for this tenant past its retention_until.
  // Cross-cutting pending: platform-scheduler `storage-retention-purge` should
  // call this per tenant on a cron; the endpoint is the manual / per-tenant trigger.
  fastify.post('/retention/purge', {
    schema: { tags: ['storage-admin'], summary: 'Hard-delete objects past their retention_until', body: purgeBody },
  }, async (req) => {
    const { limit } = purgeBody.parse(req.body ?? {})
    return purgeExpired(ctxFromIdentity(req), { limit: limit ?? 500 })
  })

  // Retention: publish storage.object.expiring_soon for objects expiring within
  // the window so owners can archive before the purge sweep removes the bytes.
  fastify.post('/retention/notify-expiring', {
    schema: { tags: ['storage-admin'], summary: 'Publish expiring_soon events for objects within the window', body: expiringBody },
  }, async (req) => {
    const { windowDays, limit } = expiringBody.parse(req.body ?? {})
    return notifyExpiringSoon(ctxFromIdentity(req), { windowDays: windowDays ?? 30, limit: limit ?? 1000 })
  })

  // Same content as the public GET /v1/storage/kinds — staff version is
  // simply scoped under /admin/ for consistency. Kinds remain code-defined.
  fastify.get('/kinds', async () => ({
    data: Object.entries(KINDS).map(([k, v]) => ({ kind: k, ...v })),
  }))
}
