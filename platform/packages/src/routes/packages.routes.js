import { z } from 'zod'
import * as service from '../services/packages.service.js'

const templateBody = z.object({
  code:           z.string().min(1).max(64),
  name:           z.string().min(1).max(256),
  description:    z.string().max(2048).optional(),
  serviceId:      z.string().uuid(),
  totalSessions:  z.number().int().positive(),
  validityDays:   z.number().int().positive().optional(),
  priceCents:     z.number().int().min(0).optional(),
  currency:       z.string().length(3).optional(),
  isActive:       z.boolean().optional(),
  metadata:       z.record(z.any()).optional(),
})

const purchaseBody = z.object({
  templateId:     z.string().uuid(),
  clientUserId:   z.string().uuid().optional(),
  pricePaidCents: z.number().int().min(0).optional(),
  metadata:       z.record(z.any()).optional(),
})

const redeemBody = z.object({
  packageId: z.string().uuid(),
  bookingId: z.string().uuid().optional(),
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

export async function packagesRoutes(fastify) {
  // Templates
  fastify.post('/v1/packages/templates', async (req, reply) => {
    const body = templateBody.parse(req.body)
    return reply.status(201).send(await service.createTemplate(ctxFromRequest(req), body))
  })

  fastify.get('/v1/packages/templates', async (req) =>
    service.listTemplates(ctxFromRequest(req), { onlyActive: req.query?.onlyActive !== 'false' }),
  )

  // Purchases
  fastify.post('/v1/packages/purchases', async (req, reply) => {
    const body = purchaseBody.parse(req.body)
    return reply.status(201).send(await service.purchase(ctxFromRequest(req), body))
  })

  fastify.get('/v1/packages/purchases/:id', async (req) =>
    service.getPurchase(ctxFromRequest(req), req.params.id),
  )

  fastify.get('/v1/packages/purchases', async (req) => {
    const clientUserId = req.query?.clientUserId ?? req.identity.userId
    return service.listPurchases(ctxFromRequest(req), clientUserId, {
      onlyActive: req.query?.onlyActive !== 'false',
    })
  })

  fastify.post('/v1/packages/redeem', async (req) => {
    const body = redeemBody.parse(req.body)
    return service.redeem(ctxFromRequest(req), body)
  })

  fastify.post('/v1/packages/refund', async (req) => {
    const body = redeemBody.parse(req.body)
    return service.refundSession(ctxFromRequest(req), body)
  })
}
