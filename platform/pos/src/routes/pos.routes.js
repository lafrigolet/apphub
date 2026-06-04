import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk'
import * as service from '../services/pos.service.js'

const tags = ['pos']

// Roles allowed to operate the till (open/add/split/pay/fire). Includes
// front-of-house staff. Managers can also do everything below.
const POS_OPERATOR_ROLES = ['waiter', 'server', 'cashier', 'staff', 'manager', 'admin', 'owner', 'super_admin']
// Sensitive operations (cancel a bill, edit tenant POS settings) need a manager.
const POS_MANAGER_ROLES = ['manager', 'admin', 'owner', 'staff', 'super_admin']

const idParams = z.object({ id: z.string().uuid() })

const openBody = z.object({
  tableId:   z.string().uuid().optional(),
  tableCode: z.string().max(64).optional(),
  currency:  z.string().length(3).optional(),
  notes:     z.string().max(512).optional(),
  metadata:  z.record(z.any()).optional(),
})

const itemBody = z.object({
  sku:             z.string().min(1).max(128),
  name:            z.string().min(1).max(256),
  qty:             z.number().int().positive(),
  unitPriceCents:  z.number().int().min(0),
  modifiers:       z.array(z.any()).optional(),
  course:          z.enum(['starter','main','dessert','drink','side','combo','other']).optional(),
  notes:           z.string().max(256).optional(),
})

const splitBody = z.object({
  mode:         z.enum(['equal','percent','amounts','items']),
  shares:       z.number().int().min(2).optional(),
  percents:     z.array(z.number()).optional(),
  amountsCents: z.array(z.number().int().min(0)).optional(),
  // split-by-item (#6): each assignment owns concrete bill_item ids
  assignments:  z.array(z.object({ itemIds: z.array(z.string().uuid()).min(1) })).optional(),
})

const payBody = z.object({
  method:      z.enum(['card','cash','wallet','voucher','external']),
  amountCents: z.number().int().positive(),
  tipCents:    z.number().int().min(0).optional(),
  externalRef: z.string().max(256).optional(),
  splitId:     z.string().uuid().optional(),
})

const cancelBody = z.object({ reason: z.string().max(512).optional() })

const fireBody = z.object({ itemIds: z.array(z.string().uuid()).optional() })

const settingsBody = z.object({
  tipSuggestions: z.array(z.number().min(0).max(100)).optional(),
  tipAllowCustom: z.boolean().optional(),
  defaultTaxRate: z.number().min(0).max(1).nullable().optional(),
})

const listQuery = z.object({
  status:  z.string().optional(),
  tableId: z.string().optional(),
  limit:   z.coerce.number().int().positive().max(500).optional(),
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

export async function posRoutes(fastify) {
  fastify.post('/v1/pos/bills', {
    schema: { tags, summary: 'Open a bill (dine-in, bar, takeaway, delivery)', body: openBody },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req, reply) => {
    const body = openBody.parse(req.body)
    return reply.status(201).send(await service.openBill(ctxFromRequest(req), body))
  })

  fastify.get('/v1/pos/bills', {
    schema: { tags, summary: 'List bills (filter by status / table)', querystring: listQuery },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => {
    const q = listQuery.parse(req.query ?? {})
    return service.listBills(ctxFromRequest(req), { status: q.status, tableId: q.tableId, limit: q.limit })
  })

  fastify.get('/v1/pos/settings', {
    schema: { tags, summary: 'Get per-tenant POS settings (tip suggestions, default tax)' },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => service.getSettings(ctxFromRequest(req)))

  fastify.put('/v1/pos/settings', {
    schema: { tags, summary: 'Update per-tenant POS settings (manager only)', body: settingsBody },
    preHandler: requireRole(...POS_MANAGER_ROLES),
  }, async (req) => {
    const body = settingsBody.parse(req.body)
    return service.updateSettings(ctxFromRequest(req), body)
  })

  fastify.get('/v1/pos/bills/:id', {
    schema: { tags, summary: 'Get one bill with items, payments, splits and tip suggestions', params: idParams },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => service.getBill(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/pos/bills/:id/items', {
    schema: { tags, summary: 'Add a line item to an open bill', params: idParams, body: itemBody },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req, reply) => {
    const body = itemBody.parse(req.body)
    return reply.status(201).send(await service.addItem(ctxFromRequest(req), req.params.id, body))
  })

  fastify.post('/v1/pos/bills/:id/fire', {
    schema: { tags, summary: 'Fire (send to kitchen/KDS) all or selected unfired items', params: idParams, body: fireBody },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => {
    const body = fireBody.parse(req.body ?? {})
    return service.fireBill(ctxFromRequest(req), req.params.id, body.itemIds)
  })

  fastify.post('/v1/pos/bills/:id/split', {
    schema: { tags, summary: 'Split a bill (equal / percent / amounts / by-item)', params: idParams, body: splitBody },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => {
    const body = splitBody.parse(req.body)
    const { mode, ...args } = body
    return service.splitBill(ctxFromRequest(req), req.params.id, mode, args)
  })

  fastify.post('/v1/pos/bills/:id/pay', {
    schema: { tags, summary: 'Register a (possibly partial / mixed) payment', params: idParams, body: payBody },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => {
    const body = payBody.parse(req.body)
    return service.payBill(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/pos/bills/:id/cancel', {
    schema: { tags, summary: 'Cancel an open/split bill with reason (manager only)', params: idParams, body: cancelBody },
    preHandler: requireRole(...POS_MANAGER_ROLES),
  }, async (req) => {
    const body = cancelBody.parse(req.body ?? {})
    return service.cancelBill(ctxFromRequest(req), req.params.id, body.reason)
  })

  fastify.post('/v1/pos/bills/:id/close', {
    schema: { tags, summary: 'Close a paid bill', params: idParams },
    preHandler: requireRole(...POS_OPERATOR_ROLES),
  }, async (req) => service.closeBill(ctxFromRequest(req), req.params.id))
}
