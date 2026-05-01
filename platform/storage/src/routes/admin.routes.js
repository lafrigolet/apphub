import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/settings.repository.js'
import { pool } from '../lib/db.js'
import { loadSettings, invalidate as invalidateSettings } from '../lib/settings.js'
import { configureClient } from '../services/storage.service.js'
import { getKind, KINDS } from '../kinds.js'

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
      return { data: await repo.listForAdmin(client) }
    } finally { client.release() }
  })

  // Same content as the public GET /v1/storage/kinds — staff version is
  // simply scoped under /admin/ for consistency. Kinds remain code-defined.
  fastify.get('/kinds', async () => ({
    data: Object.entries(KINDS).map(([k, v]) => ({ kind: k, ...v })),
  }))
}
