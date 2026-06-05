import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'

const tags = ['tpv · admin']

const patchBody = z.object({
  default_session_autoclose_hours:          z.coerce.number().int().min(1).max(72).optional(),
  default_cash_out_manager_threshold_cents: z.coerce.number().int().min(0).optional(),
  receipt_render_footer:                    z.string().max(500).optional().nullable(),
})

// Config service-level del módulo (defaults de plataforma). Los datos
// fiscales del EMISOR son por tenant y viven en /v1/tpv/settings — cada
// tenant es una entidad legal distinta.
export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  fastify.get(
    '/config',
    {
      schema: { tags, summary: 'List tpv module platform-level config (secrets masked)' },
    },
    async () => {
      const client = await pool.connect()
      try {
        return { data: await configRepo.listForAdmin(client) }
      } finally {
        client.release()
      }
    },
  )

  fastify.patch(
    '/config',
    {
      schema: { tags, summary: 'Update tpv module platform-level config values', body: patchBody },
    },
    async (req) => {
      const body = patchBody.parse(req.body ?? {})
      const client = await pool.connect()
      try {
        for (const [key, value] of Object.entries(body)) {
          if (value === undefined) continue
          await configRepo.upsertValue(client, key, value === null ? null : String(value))
        }
        return { data: await configRepo.listForAdmin(client) }
      } finally {
        client.release()
      }
    },
  )
}
