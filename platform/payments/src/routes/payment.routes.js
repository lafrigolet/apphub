import {
  CreatePaymentIntentSchema, ListIntentsQuerySchema, IntentParamsSchema,
  CaptureIntentSchema, CreateRefundSchema,
} from '../schemas/index.js'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/payment.service.js'

const TAGS = ['payments']

export async function paymentRoutes(fastify) {
  // POST /v1/payments/intents — create a one-shot PaymentIntent
  fastify.post('/intents', {
    schema: {
      tags: TAGS, summary: 'Create a PaymentIntent (one-shot charge)',
      body: CreatePaymentIntentSchema,
    },
  }, async (req, reply) => {
    const result = await service.createPaymentIntent(req.tenant, req.body)
    return reply.status(201).send({ data: result })
  })

  // GET /v1/payments/intents — list transactions for the current tenant
  fastify.get('/intents', {
    schema: {
      tags: TAGS, summary: 'List PaymentIntents / transactions for the tenant',
      querystring: ListIntentsQuerySchema,
    },
  }, async (req) => {
    const result = await service.listIntents(req.tenant, req.query)
    return result
  })

  // GET /v1/payments/intents/:id — fetch one transaction
  fastify.get('/intents/:id', {
    schema: {
      tags: TAGS, summary: 'Get a PaymentIntent / transaction by id',
      params: IntentParamsSchema,
    },
  }, async (req) => {
    const data = await service.getIntent(req.tenant, req.params.id)
    return { data }
  })

  // DELETE /v1/payments/intents/:id — cancel a non-captured intent (release hold)
  fastify.delete('/intents/:id', {
    schema: {
      tags: TAGS, summary: 'Cancel a non-captured PaymentIntent',
      params: IntentParamsSchema,
    },
  }, async (req) => {
    const data = await service.cancelIntent(req.tenant, req.params.id)
    return { data }
  })

  // POST /v1/payments/intents/:id/capture — capture an authorized intent
  fastify.post('/intents/:id/capture', {
    schema: {
      tags: TAGS, summary: 'Capture a previously-authorized PaymentIntent',
      params: IntentParamsSchema, body: CaptureIntentSchema,
    },
  }, async (req) => {
    const data = await service.captureIntent(req.tenant, req.params.id, req.body?.amountToCapture)
    return { data }
  })

  // POST /v1/payments/transactions/:id/refunds — total or partial refund.
  // Restricted to staff / super_admin (use-case §7: only staff initiate refunds).
  fastify.post('/transactions/:id/refunds', {
    preHandler: requireRole('super_admin', 'staff'),
    schema: {
      tags: TAGS, summary: 'Create a refund (total or partial) for a transaction',
      params: IntentParamsSchema, body: CreateRefundSchema,
    },
  }, async (req, reply) => {
    const result = await service.createRefund(req.tenant, req.params.id, req.body)
    return reply.status(201).send({ data: result })
  })

  // GET /v1/payments/transactions/:id/refunds — list refunds for a transaction
  fastify.get('/transactions/:id/refunds', {
    schema: {
      tags: TAGS, summary: 'List refunds for a transaction',
      params: IntentParamsSchema,
    },
  }, async (req) => {
    const data = await service.listRefunds(req.tenant, req.params.id)
    return { data }
  })
}
