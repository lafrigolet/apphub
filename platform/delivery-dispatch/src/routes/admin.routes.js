import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/settings.repository.js'
import { pool } from '../lib/db.js'

const envEnum = z.enum(['sandbox', 'production'])
const boolish = z.union([z.boolean(), z.string()])

const patchBody = z.object({
  uber_enabled:          boolish.optional().nullable(),
  uber_environment:      envEnum.optional().nullable(),
  uber_customer_id:      z.string().min(1).max(128).optional().nullable(),
  uber_client_id:        z.string().min(1).max(2048).optional().nullable(),
  uber_client_secret:    z.string().min(1).max(2048).optional().nullable(),
  uber_webhook_secret:   z.string().min(1).max(2048).optional().nullable(),
  glovo_enabled:         boolish.optional().nullable(),
  glovo_environment:     envEnum.optional().nullable(),
  glovo_api_key:         z.string().min(1).max(2048).optional().nullable(),
  glovo_webhook_secret:  z.string().min(1).max(2048).optional().nullable(),
  stuart_enabled:        boolish.optional().nullable(),
  stuart_environment:    envEnum.optional().nullable(),
  stuart_client_id:      z.string().min(1).max(2048).optional().nullable(),
  stuart_client_secret:  z.string().min(1).max(2048).optional().nullable(),
  stuart_webhook_secret: z.string().min(1).max(2048).optional().nullable(),
})

const BOOL_KEYS = new Set(['uber_enabled', 'glovo_enabled', 'stuart_enabled'])

const tags = ['delivery-dispatch · admin']

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  fastify.get('/config', {
    schema: {
      tags,
      summary: 'List delivery-carrier credentials (Uber/Glovo/Stuart)',
    },
  }, async () => {
    const client = await pool.connect()
    try { return { data: await repo.listForAdmin(client) } } finally { client.release() }
  })

  fastify.patch('/config', {
    schema: {
      tags,
      summary: 'Upsert delivery-carrier credentials (Uber/Glovo/Stuart)',
      body: patchBody,
    },
  }, async (req) => {
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
