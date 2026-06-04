import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as donorsService from '../services/donors.service.js'

const listQuery = z.object({
  search:   z.string().max(128).optional(),
  fromDate: z.string().datetime().optional(),
  toDate:   z.string().datetime().optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(200),
  offset:   z.coerce.number().int().min(0).default(0),
})

const exportQuery = z.object({
  search:   z.string().max(128).optional(),
  fromDate: z.string().datetime().optional(),
  toDate:   z.string().datetime().optional(),
})

// Admin — CRM básico de donantes (ficha + listado + export CSV).
export async function adminDonorsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))

  fastify.get(
    '/',
    {
      schema: {
        tags:        ['donations · donors admin'],
        summary:     'List unique donors (grouped by NIF/email) with totals',
        querystring: listQuery,
      },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await donorsService.listDonors(req.identity, q) }
    },
  )

  fastify.get(
    '/export.csv',
    {
      schema: {
        tags:        ['donations · donors admin'],
        summary:     'Export unique donors as CSV',
        querystring: exportQuery,
      },
    },
    async (req, reply) => {
      const q = exportQuery.parse(req.query ?? {})
      const { filename, csv, count } = await donorsService.exportDonorsCsv(req.identity, q)
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('X-Donors-Count', String(count))
      return reply.send(csv)
    },
  )

  fastify.get(
    '/:donorKey',
    {
      schema: {
        tags:    ['donations · donors admin'],
        summary: 'Get a donor profile (summary + full donation history)',
        params:  z.object({ donorKey: z.string().min(1) }),
      },
    },
    async (req) => ({ data: await donorsService.getDonor(req.identity, req.params.donorKey) }),
  )
}
