import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/settings.repository.js'
import { pool } from '../lib/db.js'

const providerEnum = z.enum(['stub', 'daily', 'twilio', 'whereby', 'jitsi'])

const patchBody = z.object({
  active_provider:        providerEnum.optional().nullable(),
  daily_api_key:          z.string().min(1).max(2048).optional().nullable(),
  daily_domain:           z.string().min(1).max(256).optional().nullable(),
  twilio_account_sid:     z.string().min(1).max(128).optional().nullable(),
  twilio_api_key_sid:     z.string().min(1).max(128).optional().nullable(),
  twilio_api_key_secret:  z.string().min(1).max(2048).optional().nullable(),
  whereby_api_key:        z.string().min(1).max(2048).optional().nullable(),
  whereby_subdomain:      z.string().min(1).max(256).optional().nullable(),
  jitsi_app_id:           z.string().min(1).max(128).optional().nullable(),
  jitsi_api_key_id:       z.string().min(1).max(128).optional().nullable(),
  jitsi_private_key:      z.string().min(1).max(8192).optional().nullable(),
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
        await repo.upsertValue(client, key, value)
      }
      return { data: await repo.listForAdmin(client) }
    } finally { client.release() }
  })
}
