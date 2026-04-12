import { CreatePaymentIntentSchema, CreateRefundSchema } from '../schemas/index.js'
import * as service from '../services/payment.service.js'
import { z } from 'zod'

export async function paymentRoutes(fastify) {
  // POST /v1/payments — create a PaymentIntent with split
  fastify.post(
    '/',
    {
      schema: {
        body: CreatePaymentIntentSchema,
      },
    },
    async (req, reply) => {
      const result = await service.createPaymentIntent(req.tenant, req.body)
      return reply.status(201).send({ data: result })
    },
  )

  // GET /v1/payments — list payments for the current tenant
  fastify.get(
    '/',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { limit, cursor } = req.query
      const result = await service.listPayments(req.tenant, limit, cursor)
      return { data: result }
    },
  )

  // GET /v1/payments/:id
  fastify.get(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const payment = await service.getPayment(req.tenant, req.params.id)
      return { data: payment }
    },
  )

  // POST /v1/payments/:id/refunds
  fastify.post(
    '/:id/refunds',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CreateRefundSchema.omit({ paymentId: true }),
      },
    },
    async (req, reply) => {
      const input = {
        ...req.body,
        paymentId: req.params.id,
      }
      const result = await service.createRefund(req.tenant, input)
      return reply.status(201).send({ data: result })
    },
  )
}
