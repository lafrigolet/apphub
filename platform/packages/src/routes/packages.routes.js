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

  // ── Family sharing ───────────────────────────────────────────────────
  const sharingTags  = ['packages · sharing']
  const transferTags = ['packages · transfers']
  const renewalTags  = ['packages · renewal']
  const idParams     = z.object({ id: z.string().uuid() })
  const userIdParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() })
  const shareBody    = z.object({
    userId:      z.string().uuid(),
    displayName: z.string().max(128).optional(),
  })
  const transferBody = z.object({
    toUserId:    z.string().uuid(),
    kind:        z.enum(['transfer', 'gift']).optional(),
    message:     z.string().max(500).optional(),
  })
  const autoRenewBody = z.object({ autoRenew: z.boolean() })

  fastify.get('/v1/packages/purchases/:id/authorized-users', {
    schema: { tags: sharingTags, summary: 'List users authorised to redeem this package', params: idParams },
  }, async (req) => ({ data: await service.listAuthorizedUsers(ctxFromRequest(req), req.params.id) }))

  fastify.post('/v1/packages/purchases/:id/authorized-users', {
    schema: { tags: sharingTags, summary: 'Authorise another user to redeem this package', params: idParams, body: shareBody },
  }, async (req, reply) => {
    const body = shareBody.parse(req.body)
    return reply.status(201).send(await service.addAuthorizedUser(ctxFromRequest(req), req.params.id, body))
  })

  fastify.delete('/v1/packages/purchases/:id/authorized-users/:userId', {
    schema: { tags: sharingTags, summary: 'Revoke authorised access', params: userIdParams },
  }, async (req, reply) => {
    await service.removeAuthorizedUser(ctxFromRequest(req), req.params.id, req.params.userId)
    return reply.status(204).send()
  })

  // ── Transfer / gifting ───────────────────────────────────────────────
  fastify.post('/v1/packages/purchases/:id/transfer', {
    schema: { tags: transferTags, summary: 'Transfer or gift the package to another user', params: idParams, body: transferBody },
  }, async (req) => {
    const body = transferBody.parse(req.body)
    return service.transferPackage(ctxFromRequest(req), req.params.id, body)
  })

  fastify.get('/v1/packages/purchases/:id/transfers', {
    schema: { tags: transferTags, summary: 'List transfer history of this package', params: idParams },
  }, async (req) => ({ data: await service.listTransfers(ctxFromRequest(req), req.params.id) }))

  // ── Auto-renew toggle + manual renew ─────────────────────────────────
  fastify.put('/v1/packages/purchases/:id/auto-renew', {
    schema: { tags: renewalTags, summary: 'Toggle auto-renewal on a package', params: idParams, body: autoRenewBody },
  }, async (req) => {
    const body = autoRenewBody.parse(req.body)
    return service.setAutoRenew(ctxFromRequest(req), req.params.id, body.autoRenew)
  })

  fastify.post('/v1/packages/purchases/:id/renew', {
    schema: { tags: renewalTags, summary: 'Manually renew a package (clones the template into a fresh purchase)', params: idParams },
  }, async (req, reply) => {
    return reply.status(201).send(await service.renewPackage(ctxFromRequest(req), req.params.id))
  })

  // ── #8 Manual balance adjustment (staff) ─────────────────────────────
  const balanceTags = ['packages · balance']
  const adjustBody  = z.object({
    delta:     z.number().int(),
    note:      z.string().max(500).optional(),
    bookingId: z.string().uuid().optional(),
  })
  fastify.post('/v1/packages/purchases/:id/adjust', {
    schema: { tags: balanceTags, summary: 'Manually adjust a package balance (staff only, reason=adjust)', params: idParams, body: adjustBody },
  }, async (req) => {
    const body = adjustBody.parse(req.body)
    return service.adjustBalance(ctxFromRequest(req), req.params.id, body)
  })

  // ── #9 Freeze / unfreeze / extend validity (staff) ───────────────────
  const freezeTags  = ['packages · freeze']
  const freezeBody  = z.object({ reason: z.string().max(500).optional() }).optional()
  const extendBody  = z.object({ days: z.number().int().positive() })

  fastify.post('/v1/packages/purchases/:id/freeze', {
    schema: { tags: freezeTags, summary: 'Freeze a package (pauses validity; staff only)', params: idParams, body: freezeBody },
  }, async (req) => {
    const body = freezeBody.parse(req.body ?? {})
    return service.freezePackage(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/packages/purchases/:id/unfreeze', {
    schema: { tags: freezeTags, summary: 'Unfreeze a package (extends expiry by frozen duration; staff only)', params: idParams },
  }, async (req) => service.unfreezePackage(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/packages/purchases/:id/extend', {
    schema: { tags: freezeTags, summary: 'Extend a package expiry by N days (staff only)', params: idParams, body: extendBody },
  }, async (req) => {
    const body = extendBody.parse(req.body)
    return service.extendExpiry(ctxFromRequest(req), req.params.id, body)
  })

  fastify.get('/v1/packages/purchases/:id/freezes', {
    schema: { tags: freezeTags, summary: 'List freeze history of this package', params: idParams },
  }, async (req) => ({ data: await service.listFreezes(ctxFromRequest(req), req.params.id) }))

  // ── #4 Cancellation with proportional monetary refund (staff) ────────
  const cancelTags = ['packages · refund']
  const cancelBody = z.object({ penaltyPct: z.number().min(0).max(100).optional() }).optional()
  fastify.post('/v1/packages/purchases/:id/cancel', {
    schema: { tags: cancelTags, summary: 'Cancel a package and emit package.refunded with the proportional refund amount (staff only)', params: idParams, body: cancelBody },
  }, async (req) => {
    const body = cancelBody.parse(req.body ?? {})
    return service.cancelPackage(ctxFromRequest(req), req.params.id, body)
  })
}
