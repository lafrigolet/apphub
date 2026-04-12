import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/error.middleware.js'
import { tenantMiddleware } from '../middleware/tenant.middleware.js'
import * as service from '../services/payment.service.js'
import { CreatePaymentIntentSchema, CreateRefundSchema } from '../types/index.js'
import type { ApiSuccess } from '../types/index.js'

export const paymentRouter = Router()

paymentRouter.use(tenantMiddleware)

// POST /v1/payments — create a PaymentIntent with split
paymentRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = CreatePaymentIntentSchema.parse(req.body)
    const result = await service.createPaymentIntent(req.tenant, input)
    const response: ApiSuccess<typeof result> = { data: result }
    res.status(201).json(response)
  }),
)

// GET /v1/payments — list payments for the current tenant
paymentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
    })
    const { limit, cursor } = schema.parse(req.query)
    const result = await service.listPayments(req.tenant, limit, cursor)
    const response: ApiSuccess<typeof result> = { data: result }
    res.json(response)
  }),
)

// GET /v1/payments/:id
paymentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const payment = await service.getPayment(req.tenant, req.params['id']!)
    const response: ApiSuccess<typeof payment> = { data: payment }
    res.json(response)
  }),
)

// POST /v1/payments/:id/refunds
paymentRouter.post(
  '/:id/refunds',
  asyncHandler(async (req, res) => {
    const input = CreateRefundSchema.parse({
      ...req.body,
      paymentId: req.params['id'],
    })
    const result = await service.createRefund(req.tenant, input)
    const response: ApiSuccess<typeof result> = { data: result }
    res.status(201).json(response)
  }),
)
