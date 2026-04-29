import { z } from 'zod'
import * as service from '../services/practitioner-payouts.service.js'

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
  grossCents:       z.number().int().min(0),
  commissionCents:  z.number().int().min(0),
  occurredAt:       z.string().datetime().optional(),
  metadata:         z.record(z.any()).optional(),
})

const markPaidBody = z.object({
  externalRef: z.string().max(256).optional(),
})

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
  // Rules
  fastify.post('/v1/practitioner-payouts/rules', async (req, reply) => {
    const body = ruleBody.parse(req.body)
    return reply.status(201).send(await service.createRule(ctxFromRequest(req), body))
  })

  fastify.get('/v1/practitioner-payouts/rules', async (req) =>
    service.listRules(ctxFromRequest(req), {
      practitionerId: req.query?.practitionerId,
      serviceId:      req.query?.serviceId,
    }),
  )

  // Accruals
  fastify.post('/v1/practitioner-payouts/accruals', async (req, reply) => {
    const body = accrualBody.parse(req.body)
    return reply.status(201).send(await service.createAccrual(ctxFromRequest(req), body))
  })

  fastify.get('/v1/practitioner-payouts/accruals', async (req) =>
    service.listAccruals(ctxFromRequest(req), {
      practitionerId: req.query?.practitionerId,
      status:         req.query?.status,
      from:           req.query?.from,
      to:             req.query?.to,
    }),
  )

  // Payouts (close period + mark paid)
  fastify.post('/v1/practitioner-payouts/payouts/close', async (req, reply) => {
    const body = closeBody.parse(req.body)
    return reply.status(201).send(await service.closePeriod(ctxFromRequest(req), body))
  })

  fastify.post('/v1/practitioner-payouts/payouts/:id/pay', async (req) => {
    const body = markPaidBody.parse(req.body ?? {})
    return service.markPayoutPaid(ctxFromRequest(req), req.params.id, body.externalRef)
  })

  fastify.get('/v1/practitioner-payouts/payouts/:id', async (req) =>
    service.getPayout(ctxFromRequest(req), req.params.id),
  )

  fastify.get('/v1/practitioner-payouts/payouts', async (req) =>
    service.listPayouts(ctxFromRequest(req), {
      practitionerId: req.query?.practitionerId,
      status:         req.query?.status,
    }),
  )
}
