import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/reports.service.js'

const tags = ['tpv · reports']

const MANAGER_ROLES = ['manager', 'owner', 'admin', 'staff', 'super_admin']

const xQuery = z.object({ sessionId: z.string().uuid() })

const sessionParams = z.object({ sessionId: z.string().uuid() })

const periodQuery = z.object({
  from:    z.string().datetime(),
  to:      z.string().datetime(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
})

export async function reportsRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('cashier', ...MANAGER_ROLES))

  fastify.get(
    '/x',
    {
      schema: { tags, summary: 'X report — live sales of an in-progress session (no close, no reset)', querystring: xQuery },
    },
    async (req) => {
      const q = xQuery.parse(req.query ?? {})
      return { data: await service.getXReport(req.identity, q.sessionId) }
    },
  )

  fastify.get(
    '/z/:sessionId',
    {
      schema: { tags, summary: 'Z report — immutable numbered close snapshot of a session', params: sessionParams },
    },
    async (req) => ({ data: await service.getZReport(req.identity, req.params.sessionId) }),
  )

  fastify.get(
    '/period',
    {
      preHandler: requireRole(...MANAGER_ROLES),
      schema: { tags, summary: 'Sales aggregates by period (day/week/month buckets, gross vs net)', querystring: periodQuery },
    },
    async (req) => {
      const q = periodQuery.parse(req.query ?? {})
      return { data: await service.getPeriodReport(req.identity, q) }
    },
  )

  fastify.get(
    '/export.csv',
    {
      preHandler: requireRole(...MANAGER_ROLES),
      schema: { tags, summary: 'Accounting CSV export — receipts and credit notes with VAT breakdown', querystring: periodQuery.omit({ groupBy: true }) },
    },
    async (req, reply) => {
      const q = periodQuery.omit({ groupBy: true }).parse(req.query ?? {})
      reply.type('text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="tpv-export.csv"')
      return service.exportCsv(req.identity, q)
    },
  )
}
