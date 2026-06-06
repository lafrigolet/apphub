import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/config.repository.js'
import { pool } from '../lib/db.js'
import { reloadStripeFromDb } from '../lib/stripe.js'

const tags = ['payments · admin']

// Two key sets, prefix-validated per mode so a live key can never land in the
// test slot (or vice versa). whsec_ is mode-agnostic by format.
const patchBody = z.object({
  stripe_mode:                 z.enum(['test', 'live']).optional(),
  stripe_test_secret_key:      z.string().startsWith('sk_test_').max(2048).optional().nullable(),
  stripe_test_publishable_key: z.string().startsWith('pk_test_').max(2048).optional().nullable(),
  stripe_test_webhook_secret:  z.string().startsWith('whsec_').max(2048).optional().nullable(),
  stripe_live_secret_key:      z.string().startsWith('sk_live_').max(2048).optional().nullable(),
  stripe_live_publishable_key: z.string().startsWith('pk_live_').max(2048).optional().nullable(),
  stripe_live_webhook_secret:  z.string().startsWith('whsec_').max(2048).optional().nullable(),
})

// Keys whose change must re-instantiate the Stripe client: the active-mode
// switch itself, or either secret key (the active one may be the touched one).
const RELOAD_TRIGGERS = new Set([
  'stripe_mode', 'stripe_test_secret_key', 'stripe_live_secret_key',
])

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  fastify.get('/config', {
    schema: { tags, summary: 'List payments module config (secrets as configured flags, stripe_mode as value)' },
  }, async () => {
    const client = await pool.connect()
    try {
      return { data: await repo.listConfig(client) }
    } finally {
      client.release()
    }
  })

  fastify.patch('/config', {
    schema: { tags, summary: 'Upsert Stripe test/live key sets and/or flip the active mode', body: patchBody },
  }, async (req) => {
    const body = patchBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      let needsReload = false
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        await repo.upsertValue(client, key, value, req.identity?.userId)
        if (RELOAD_TRIGGERS.has(key)) needsReload = true
      }
      const data = await repo.listConfig(client)
      // Re-instantiate the Stripe client so the new mode/key takes effect
      // without a redeploy.
      if (needsReload) await reloadStripeFromDb()
      return { data }
    } finally {
      client.release()
    }
  })
}
