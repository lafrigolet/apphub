import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import { withTenantTransaction } from '../lib/db.js'
import * as settingsRepo from '../repositories/settings.repository.js'

const tags = ['tpv · settings']

const putBody = z.object({
  issuerNif:                    z.string().min(1).max(20).optional(),
  issuerName:                   z.string().min(1).max(256).optional(),
  issuerAddress:                z.string().max(512).optional().nullable(),
  issuerPostalCode:             z.string().max(16).optional().nullable(),
  issuerCity:                   z.string().max(128).optional().nullable(),
  issuerCountry:                z.string().length(2).optional(),
  autoIssueSimplified:          z.boolean().optional(),
  cashOutManagerThresholdCents: z.number().int().min(0).optional(),
  sessionAutocloseHours:        z.number().int().min(1).max(72).optional(),
  convertWindowDays:            z.number().int().min(1).max(365).optional(),
  defaultSimplifiedSeriesCode:  z.string().max(8).optional(),
  defaultInvoiceSeriesCode:     z.string().max(8).optional(),
  defaultCreditNoteSeriesCode:  z.string().max(8).optional(),
  receiptFooter:                z.string().max(500).optional().nullable(),
})

// Settings operativos por tenant — incluye el emisor fiscal (NIF, razón
// social, dirección) que se snapshotea en cada recibo emitido.
export async function settingsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('manager', 'owner', 'admin', 'staff', 'super_admin'))

  fastify.get(
    '/',
    {
      schema: { tags, summary: 'Get tenant TPV settings (fiscal issuer, thresholds, default series, receipt footer)' },
    },
    async (req) => {
      const data = await withTenantTransaction(
        req.identity.appId, req.identity.tenantId, req.identity.subTenantId,
        (c) => settingsRepo.getOrDefaults(c),
      )
      return { data }
    },
  )

  fastify.put(
    '/',
    {
      schema: { tags, summary: 'Upsert tenant TPV settings (partial — only provided fields change)', body: putBody },
    },
    async (req) => {
      const body = putBody.parse(req.body ?? {})
      const data = await withTenantTransaction(
        req.identity.appId, req.identity.tenantId, req.identity.subTenantId,
        (c) => settingsRepo.upsert(c, {
          appId: req.identity.appId,
          tenantId: req.identity.tenantId,
          subTenantId: req.identity.subTenantId ?? null,
          ...body,
        }),
      )
      return { data }
    },
  )
}
