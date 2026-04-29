import { z } from 'zod'
import * as service from '../services/pos.service.js'

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
  mode:         z.enum(['equal','percent','amounts']),
  shares:       z.number().int().min(2).optional(),
  percents:     z.array(z.number()).optional(),
  amountsCents: z.array(z.number().int().min(0)).optional(),
})

const payBody = z.object({
  method:      z.enum(['card','cash','wallet','voucher','external']),
  amountCents: z.number().int().positive(),
  tipCents:    z.number().int().min(0).optional(),
  externalRef: z.string().max(256).optional(),
  splitId:     z.string().uuid().optional(),
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
  fastify.post('/v1/pos/bills', async (req, reply) => {
    const body = openBody.parse(req.body)
    return reply.status(201).send(await service.openBill(ctxFromRequest(req), body))
  })

  fastify.get('/v1/pos/bills', async (req) =>
    service.listBills(ctxFromRequest(req), {
      status:  req.query?.status,
      tableId: req.query?.tableId,
      limit:   req.query?.limit ? Number(req.query.limit) : undefined,
    }),
  )

  fastify.get('/v1/pos/bills/:id', async (req) =>
    service.getBill(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/pos/bills/:id/items', async (req, reply) => {
    const body = itemBody.parse(req.body)
    return reply.status(201).send(await service.addItem(ctxFromRequest(req), req.params.id, body))
  })

  fastify.post('/v1/pos/bills/:id/split', async (req) => {
    const body = splitBody.parse(req.body)
    const { mode, ...args } = body
    return service.splitBill(ctxFromRequest(req), req.params.id, mode, args)
  })

  fastify.post('/v1/pos/bills/:id/pay', async (req) => {
    const body = payBody.parse(req.body)
    return service.payBill(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/pos/bills/:id/close', async (req) =>
    service.closeBill(ctxFromRequest(req), req.params.id),
  )
}
