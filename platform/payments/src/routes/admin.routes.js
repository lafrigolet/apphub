import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/config.repository.js'
import { pool } from '../lib/db.js'
import { reloadStripeFromDb } from '../lib/stripe.js'

const patchBody = z.object({
  stripe_publishable_key: z.string().min(1).max(2048).optional().nullable(),
  stripe_secret_key:      z.string().min(1).max(2048).optional().nullable(),
  stripe_webhook_secret:  z.string().min(1).max(2048).optional().nullable(),
})

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  fastify.get('/config', async () => {
    const client = await pool.connect()
    try {
      return { data: await repo.listConfig(client) }
    } finally {
      client.release()
    }
  })

  fastify.patch('/config', async (req) => {
    const body = patchBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      let touchedStripeKey = false
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        await repo.upsertValue(client, key, value, req.identity?.userId)
        if (key === 'stripe_secret_key') touchedStripeKey = true
      }
      const data = await repo.listConfig(client)
      // Re-instantiate the Stripe client so the new secret key takes effect
      // without a redeploy.
      if (touchedStripeKey) await reloadStripeFromDb()
      return { data }
    } finally {
      client.release()
    }
  })
}
