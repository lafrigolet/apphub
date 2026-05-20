import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as certService     from '../services/certificate.service.js'
import * as modelo182Service from '../services/modelo182.service.js'

const generateBody = z.object({
  year:     z.number().int().min(2024).max(2100),
  donorNif: z.string().min(5).max(32).optional(),
})

const modelo182Query = z.object({
  year:         z.coerce.number().int().min(2024).max(2100),
  contactPhone: z.string().max(15).optional(),
  contactName:  z.string().max(64).optional(),
})

export async function adminFiscalRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))

  fastify.get(
    '/certificates',
    {
      schema: {
        tags:    ['donations · fiscal'],
        summary: 'List generated annual certificates',
        querystring: z.object({ year: z.coerce.number().int().optional() }),
      },
    },
    async (req) => {
      const { year } = req.query.year ? { year: Number(req.query.year) } : { year: undefined }
      return { data: await certService.listCertificates(req.identity, { year }) }
    },
  )

  fastify.post(
    '/certificates/generate',
    {
      schema: {
        tags:    ['donations · fiscal'],
        summary: 'Generate annual donor certificates (PDF) for a fiscal year',
        body:    generateBody,
      },
    },
    async (req) => {
      const body = generateBody.parse(req.body ?? {})
      // El redis viene del proceso plataforma; lo recogemos del scope
      // global a través del fastify decorator si lo hubiera. Como no
      // lo hay aún, dejamos que el handler omita events (el certificado
      // queda persistido igual; los emails se mandan en V2 cuando
      // notifications se enlace al evento).
      const data = await certService.generateAnnualCertificates(
        req.identity, body, { redis: fastify._redis ?? null },
      )
      return { data }
    },
  )

  fastify.get(
    '/modelo-182',
    {
      schema: {
        tags:    ['donations · fiscal'],
        summary: 'Export AEAT modelo 182 TXT for a fiscal year',
        querystring: modelo182Query,
      },
    },
    async (req, reply) => {
      const q = modelo182Query.parse(req.query ?? {})
      const { filename, buffer, year, count, totalCents } =
        await modelo182Service.exportModelo182(req.identity, q)
      reply
        .header('Content-Type', 'text/plain; charset=iso-8859-1')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('X-Donors-Count', String(count))
        .header('X-Donors-Total-Cents', String(totalCents))
        .header('X-Fiscal-Year', String(year))
      return reply.send(buffer)
    },
  )
}
