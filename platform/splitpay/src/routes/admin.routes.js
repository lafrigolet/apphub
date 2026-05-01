import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/config.repository.js'
import { pool } from '../lib/db.js'
import { reloadStripeFromDb } from '../lib/stripe.js'

const patchBody = z.object({
  platform_account_id:    z.string().min(1).max(256).optional().nullable(),
  stripe_secret_key:      z.string().startsWith('sk_').max(2048).optional().nullable(),
  stripe_publishable_key: z.string().startsWith('pk_').max(2048).optional().nullable(),
  stripe_webhook_secret:  z.string().startsWith('whsec_').max(2048).optional().nullable(),
})

export async function adminRoutes(fastify) {
  fastify.addHook('onRequest', requireRole('super_admin', 'staff'))

  fastify.get('/config', async () => {
    const client = await pool.connect()
    try { return { data: await repo.listConfig(client) } } finally { client.release() }
  })

  fastify.patch('/config', async (req) => {
    const body = patchBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        await repo.upsertValue(client, key, value)
      }
      // Force the next call to use the freshly-updated secret_key.
      await reloadStripeFromDb()
      return { data: await repo.listConfig(client) }
    } finally { client.release() }
  })
}
