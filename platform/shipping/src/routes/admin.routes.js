import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/settings.repository.js'
import { pool } from '../lib/db.js'

const envEnum = z.enum(['sandbox', 'production'])
const boolish = z.union([z.boolean(), z.string()])

const patchBody = z.object({
  ups_enabled:             boolish.optional().nullable(),
  ups_environment:         envEnum.optional().nullable(),
  ups_account_number:      z.string().min(1).max(64).optional().nullable(),
  ups_client_id:           z.string().min(1).max(2048).optional().nullable(),
  ups_client_secret:       z.string().min(1).max(2048).optional().nullable(),
  fedex_enabled:           boolish.optional().nullable(),
  fedex_environment:       envEnum.optional().nullable(),
  fedex_account_number:    z.string().min(1).max(64).optional().nullable(),
  fedex_meter_number:      z.string().min(1).max(64).optional().nullable(),
  fedex_api_key:           z.string().min(1).max(2048).optional().nullable(),
  fedex_secret_key:        z.string().min(1).max(2048).optional().nullable(),
  dhl_enabled:             boolish.optional().nullable(),
  dhl_environment:         envEnum.optional().nullable(),
  dhl_account_number:      z.string().min(1).max(64).optional().nullable(),
  dhl_api_key:             z.string().min(1).max(2048).optional().nullable(),
  dhl_api_secret:          z.string().min(1).max(2048).optional().nullable(),
  easypost_enabled:        boolish.optional().nullable(),
  easypost_environment:    envEnum.optional().nullable(),
  easypost_api_key:        z.string().min(1).max(2048).optional().nullable(),
  easypost_webhook_secret: z.string().min(1).max(2048).optional().nullable(),
})

const BOOL_KEYS = new Set([
  'ups_enabled', 'fedex_enabled', 'dhl_enabled', 'easypost_enabled',
])

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
        const v = BOOL_KEYS.has(key) ? String(!!value) : value
        await repo.upsertValue(client, key, v)
      }
      return { data: await repo.listForAdmin(client) }
    } finally { client.release() }
  })
}
