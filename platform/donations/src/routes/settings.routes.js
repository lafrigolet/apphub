import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as settingsService from '../services/tenant-settings.service.js'

const publicSuggestedQuery = z.object({
  appId:    z.string().min(1),
  tenantId: z.string().uuid(),
  causeId:  z.string().uuid().optional(),
})

const updateSettingsBody = z.object({
  defaultSuggestedAmountsCents: z.array(z.number().int().min(100)).max(12),
})

// Pública — el formulario de donación lee los importes sugeridos
// (override de la causa → default del tenant). Sin JWT.
export async function publicSettingsRoutes(fastify) {
  fastify.get(
    '/suggested-amounts',
    {
      config: { public: true },
      schema: {
        tags:        ['donations · settings'],
        summary:     'Suggested donation amounts for a tenant (cause override → tenant default)',
        querystring: publicSuggestedQuery,
      },
    },
    async (req) => {
      const q = publicSuggestedQuery.parse(req.query ?? {})
      return { data: { suggestedAmountsCents: await settingsService.getPublicSuggestedAmounts(q) } }
    },
  )
}

// Admin — gestiona la configuración del tenant.
export async function adminSettingsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))

  fastify.get(
    '/',
    { schema: { tags: ['donations · settings admin'], summary: 'Get tenant donation settings' } },
    async (req) => ({ data: await settingsService.getSettings(req.identity) }),
  )

  fastify.put(
    '/',
    {
      schema: {
        tags:    ['donations · settings admin'],
        summary: 'Update tenant donation settings (suggested amounts)',
        body:    updateSettingsBody,
      },
    },
    async (req) => {
      const body = updateSettingsBody.parse(req.body ?? {})
      return { data: await settingsService.updateSettings(req.identity, body) }
    },
  )
}
