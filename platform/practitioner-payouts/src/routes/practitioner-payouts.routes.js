import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/practitioner-payouts.service.js'

// All management endpoints require an elevated role. ctxFromRequest still
// reads role from the JWT identity, but the guard enforces it.
const MANAGE_ROLES = ['super_admin', 'staff', 'admin', 'owner']

const ruleBody = z.object({
  practitionerId:  z.string().uuid(),
  serviceId:       z.string().uuid().optional(),
  ratePct:         z.number().min(0).max(100),
  flatFeeCents:    z.number().int().min(0).optional(),
  effectiveFrom:   z.string().datetime().optional(),
  effectiveUntil:  z.string().datetime().optional(),
  metadata:        z.record(z.any()).optional(),
})

const closeBody = z.object({
  practitionerId: z.string().uuid(),
  periodStart:    z.string().datetime(),
  periodEnd:      z.string().datetime(),
  currency:       z.string().length(3).optional(),
})

const accrualBody = z.object({
  practitionerId:   z.string().uuid(),
  serviceId:        z.string().uuid().optional(),
  bookingId:        z.string().uuid().optional(),
  grossCents:       z.number().int(),
  commissionCents:  z.number().int(),
  type:             z.enum(['booking_commission', 'adjustment', 'advance', 'reversal']).optional(),
  occurredAt:       z.string().datetime().optional(),
  metadata:         z.record(z.any()).optional(),
})

const markPaidBody = z.object({
  externalRef: z.string().max(256).optional(),
})

const withholdingBody = z.object({
  practitionerId:  z.string().uuid().optional().nullable(),
  withholdingPct:  z.number().min(0).max(100),
  metadata:        z.record(z.any()).optional(),
})

const scheduleBody = z.object({
  practitionerId: z.string().uuid(),
  period:         z.enum(['weekly', 'biweekly', 'monthly']),
  anchorDay:      z.number().int().min(0).max(31).optional(),
  nextRunAt:      z.string().datetime(),
  isActive:       z.boolean().optional(),
  metadata:       z.record(z.any()).optional(),
})

const scheduleUpdateBody = z.object({
  period:    z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  anchorDay: z.number().int().min(0).max(31).optional(),
  nextRunAt: z.string().datetime().optional(),
  isActive:  z.boolean().optional(),
  metadata:  z.record(z.any()).optional(),
})

const TAG = 'practitioner-payouts'

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function payoutsRoutes(fastify) {
  // Every management endpoint requires an elevated role.
  fastify.addHook('preHandler', requireRole(...MANAGE_ROLES))

  // ── Rules ────────────────────────────────────────────────────────────
  fastify.post('/v1/practitioner-payouts/rules', {
    schema: { tags: [`${TAG} · rules`], summary: 'Create a commission rule', body: ruleBody },
  }, async (req, reply) => {
    const body = ruleBody.parse(req.body)
    return reply.status(201).send(await service.createRule(ctxFromRequest(req), body))
  })

  fastify.get('/v1/practitioner-payouts/rules', {
    schema: {
      tags: [`${TAG} · rules`], summary: 'List commission rules',
      querystring: z.object({ practitionerId: z.string().optional(), serviceId: z.string().optional() }),
    },
  }, async (req) => service.listRules(ctxFromRequest(req), {
    practitionerId: req.query?.practitionerId,
    serviceId:      req.query?.serviceId,
  }))

  // ── Accruals ─────────────────────────────────────────────────────────
  fastify.post('/v1/practitioner-payouts/accruals', {
    schema: {
      tags: [`${TAG} · accruals`],
      summary: 'Create an accrual (manual commission / adjustment / advance)',
      body: accrualBody,
    },
  }, async (req, reply) => {
    const body = accrualBody.parse(req.body)
    return reply.status(201).send(await service.createAccrual(ctxFromRequest(req), body))
  })

  fastify.get('/v1/practitioner-payouts/accruals', {
    schema: {
      tags: [`${TAG} · accruals`], summary: 'List accruals',
      querystring: z.object({
        practitionerId: z.string().optional(), status: z.string().optional(),
        from: z.string().optional(), to: z.string().optional(),
      }),
    },
  }, async (req) => service.listAccruals(ctxFromRequest(req), {
    practitionerId: req.query?.practitionerId,
    status:         req.query?.status,
    from:           req.query?.from,
    to:             req.query?.to,
  }))

  // ── Payouts (close period + mark paid) ───────────────────────────────
  fastify.post('/v1/practitioner-payouts/payouts/close', {
    schema: { tags: [`${TAG} · payouts`], summary: 'Close a period into a payout', body: closeBody },
  }, async (req, reply) => {
    const body = closeBody.parse(req.body)
    return reply.status(201).send(await service.closePeriod(ctxFromRequest(req), body))
  })

  fastify.post('/v1/practitioner-payouts/payouts/:id/pay', {
    schema: {
      tags: [`${TAG} · payouts`], summary: 'Mark a pending payout as paid (optional externalRef in body)',
      params: z.object({ id: z.string().uuid() }),
    },
  }, async (req) => {
    const body = markPaidBody.parse(req.body ?? {})
    return service.markPayoutPaid(ctxFromRequest(req), req.params.id, body.externalRef)
  })

  fastify.get('/v1/practitioner-payouts/payouts/:id', {
    schema: {
      tags: [`${TAG} · payouts`], summary: 'Get a payout by id',
      params: z.object({ id: z.string().uuid() }),
    },
  }, async (req) => service.getPayout(ctxFromRequest(req), req.params.id))

  fastify.get('/v1/practitioner-payouts/payouts', {
    schema: {
      tags: [`${TAG} · payouts`], summary: 'List payouts',
      querystring: z.object({ practitionerId: z.string().optional(), status: z.string().optional() }),
    },
  }, async (req) => service.listPayouts(ctxFromRequest(req), {
    practitionerId: req.query?.practitionerId,
    status:         req.query?.status,
  }))

  // PDF statement for a single payout — period header + accrual lines.
  fastify.get('/v1/practitioner-payouts/payouts/:id/pdf', {
    schema: {
      tags: [`${TAG} · pdf`], summary: 'Download a payout statement as PDF',
      params: z.object({ id: z.string().uuid() }),
    },
  }, async (req, reply) => {
    const { filename, pdf } = await service.exportPayoutPdf(ctxFromRequest(req), req.params.id)
    reply.header('content-type', 'application/pdf')
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    return reply.send(pdf)
  })

  // ── Withholding (IRPF) settings ──────────────────────────────────────
  fastify.get('/v1/practitioner-payouts/withholding-settings', {
    schema: { tags: [`${TAG} · withholding`], summary: 'List withholding settings (tenant default + overrides)' },
  }, async (req) => service.listWithholdingSettings(ctxFromRequest(req)))

  fastify.put('/v1/practitioner-payouts/withholding-settings', {
    schema: {
      tags: [`${TAG} · withholding`],
      summary: 'Upsert the tenant default (practitionerId null) or a per-practitioner override',
      body: withholdingBody,
    },
  }, async (req) => {
    const body = withholdingBody.parse(req.body)
    return service.upsertWithholdingSetting(ctxFromRequest(req), body)
  })

  // ── Payout schedules CRUD ────────────────────────────────────────────
  fastify.post('/v1/practitioner-payouts/schedules', {
    schema: { tags: [`${TAG} · schedules`], summary: 'Create a payout schedule', body: scheduleBody },
  }, async (req, reply) => {
    const body = scheduleBody.parse(req.body)
    return reply.status(201).send(await service.createSchedule(ctxFromRequest(req), body))
  })

  fastify.get('/v1/practitioner-payouts/schedules', {
    schema: {
      tags: [`${TAG} · schedules`], summary: 'List payout schedules',
      querystring: z.object({ practitionerId: z.string().optional(), isActive: z.coerce.boolean().optional() }),
    },
  }, async (req) => service.listSchedules(ctxFromRequest(req), {
    practitionerId: req.query?.practitionerId,
    isActive:       req.query?.isActive,
  }))

  fastify.get('/v1/practitioner-payouts/schedules/:id', {
    schema: {
      tags: [`${TAG} · schedules`], summary: 'Get a payout schedule by id',
      params: z.object({ id: z.string().uuid() }),
    },
  }, async (req) => service.getSchedule(ctxFromRequest(req), req.params.id))

  fastify.patch('/v1/practitioner-payouts/schedules/:id', {
    schema: {
      tags: [`${TAG} · schedules`], summary: 'Update / pause / resume a payout schedule',
      params: z.object({ id: z.string().uuid() }), body: scheduleUpdateBody,
    },
  }, async (req) => {
    const body = scheduleUpdateBody.parse(req.body ?? {})
    return service.updateSchedule(ctxFromRequest(req), req.params.id, body)
  })

  fastify.delete('/v1/practitioner-payouts/schedules/:id', {
    schema: {
      tags: [`${TAG} · schedules`], summary: 'Delete a payout schedule',
      params: z.object({ id: z.string().uuid() }),
    },
  }, async (req) => service.deleteSchedule(ctxFromRequest(req), req.params.id))
}
