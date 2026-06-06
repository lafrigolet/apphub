import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/config.repository.js'
import { pool } from '../lib/db.js'
import { reloadStripeFromDb } from '../lib/stripe.js'

// Two key sets, prefix-validated per mode so a live key can never land in the
// test slot (or vice versa). whsec_ and acct_ are mode-agnostic by format.
const patchBody = z.object({
  stripe_mode:                 z.enum(['test', 'live']).optional(),
  platform_account_id_test:    z.string().startsWith('acct_').max(256).optional().nullable(),
  platform_account_id_live:    z.string().startsWith('acct_').max(256).optional().nullable(),
  stripe_test_secret_key:      z.string().startsWith('sk_test_').max(2048).optional().nullable(),
  stripe_test_publishable_key: z.string().startsWith('pk_test_').max(2048).optional().nullable(),
  stripe_test_webhook_secret:  z.string().startsWith('whsec_').max(2048).optional().nullable(),
  stripe_live_secret_key:      z.string().startsWith('sk_live_').max(2048).optional().nullable(),
  stripe_live_publishable_key: z.string().startsWith('pk_live_').max(2048).optional().nullable(),
  stripe_live_webhook_secret:  z.string().startsWith('whsec_').max(2048).optional().nullable(),
  // Configurable Stripe processing fee (priority #9), shared between modes.
  // percent is a fraction (0–1, e.g. 0.014 = 1.4%); fixed is in the smallest
  // currency unit (cents). Stored as plain strings; the split engine resolves
  // them on each charge.
  stripe_fee_percent:     z.coerce.number().min(0).max(1).optional().nullable(),
  stripe_fee_fixed:       z.coerce.number().int().min(0).max(100000).optional().nullable(),
})

const tags = ['splitpay · admin']

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  fastify.get('/config', {
    schema: { tags, summary: 'List splitpay module config (secrets as configured flags, plains as values)' },
  }, async () => {
    const client = await pool.connect()
    try { return { data: await repo.listConfig(client) } } finally { client.release() }
  })

  fastify.patch('/config', {
    schema: { tags, summary: 'Upsert Stripe test/live key sets, account ids, fees and/or flip the active mode', body: patchBody },
  }, async (req) => {
    const body = patchBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        // Numeric fee config is persisted as a plain string.
        await repo.upsertValue(client, key, value === null ? null : String(value))
      }
      // Force the next call to use the freshly-updated secret_key.
      await reloadStripeFromDb()
      return { data: await repo.listConfig(client) }
    } finally { client.release() }
  })
}
