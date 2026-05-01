import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as repo from '../repositories/oauth-providers.repository.js'
import { pool } from '../lib/db.js'

const patchBody = z.object({
  clientId:     z.string().min(1).max(512).optional().nullable(),
  clientSecret: z.string().min(1).max(2048).optional().nullable(),
  enabled:      z.boolean().optional(),
})

export async function adminRoutes(fastify) {
  // All admin endpoints require the staff/super_admin role.
  fastify.addHook('onRequest', requireRole('super_admin', 'staff'))

  fastify.get('/oauth-providers', async () => {
    const client = await pool.connect()
    try {
      return { data: await repo.listProviders(client) }
    } finally {
      client.release()
    }
  })

  fastify.patch('/oauth-providers/:provider', async (req, reply) => {
    const provider = req.params.provider
    if (!['google', 'facebook'].includes(provider)) {
      return reply.code(400).send({ error: { code: 'INVALID_PROVIDER', message: 'unknown provider' } })
    }
    const body = patchBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      await repo.upsertProvider(client, { provider, ...body, updatedByUserId: req.identity?.userId })
      const list = await repo.listProviders(client)
      return { data: list.find((p) => p.provider === provider) }
    } finally {
      client.release()
    }
  })
}
