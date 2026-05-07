import { z } from 'zod'
import * as service from '../services/checkout-session.service.js'

const lineItemSchema = z.object({
  price:    z.string().min(1).optional(),
  quantity: z.number().int().min(1).default(1),
  // Para precios ad-hoc:
  price_data: z.object({
    currency:    z.string().length(3),
    unit_amount: z.number().int().positive(),
    product_data: z.object({ name: z.string().min(1) }),
    recurring:    z.object({ interval: z.enum(['day','week','month','year']), interval_count: z.number().int().positive().default(1) }).optional(),
  }).optional(),
})

const createBody = z.object({
  mode:          z.enum(['payment', 'subscription']),
  lineItems:     z.array(lineItemSchema).min(1).max(20),
  successUrl:    z.string().url(),
  cancelUrl:     z.string().url(),
  customerEmail: z.string().email().optional(),
  splitRuleId:   z.string().uuid().optional(),
  currency:      z.string().length(3).default('eur'),
  metadata:      z.record(z.string(), z.string()).optional(),
})

export async function checkoutSessionRoutes(fastify) {
  // POST /v1/splitpay/checkout-sessions — crear sesión.
  fastify.post('/', async (req, reply) => {
    const body = createBody.parse(req.body ?? {})
    const result = await service.createCheckoutSession(req.tenant, body)
    return reply.status(201).send({ data: result })
  })

  // GET /v1/splitpay/checkout-sessions/:id
  fastify.get('/:id', async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id)
    const row = await service.getCheckoutSession(req.tenant, id)
    if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Checkout session not found' } })
    return { data: row }
  })
}
