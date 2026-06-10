import { CreateCheckoutSessionSchema, IntentParamsSchema } from '../schemas/index.js'
import * as checkout from '../services/checkout.service.js'
import * as payments from '../services/payment.service.js'

const TAGS = ['payments · checkout']

// Checkout Session endpoints (QR / payment link). Registered inside the
// encapsulated `payments` scope (src/index.js), so they inherit req.tenant, the
// zod compilers and the Stripe error handler. Authenticated like the rest of
// /v1/payments (appGuard).
export async function checkoutRoutes(fastify) {
  // POST /v1/payments/checkout-sessions — create a hosted Checkout Session.
  // Returns { url, qr } for the cashier to display/share; the customer pays on
  // their own device.
  fastify.post('/checkout-sessions', {
    schema: {
      tags: TAGS, summary: 'Create a hosted Checkout Session (QR / payment link)',
      body: CreateCheckoutSessionSchema,
    },
  }, async (req, reply) => {
    const data = await checkout.createCheckoutSession(req.tenant, req.body)
    return reply.status(201).send({ data })
  })

  // GET /v1/payments/checkout-sessions/:id — poll the transaction to see whether
  // the customer has paid (status flips to 'succeeded' via the webhook). `id` is
  // the transactionId returned at creation.
  fastify.get('/checkout-sessions/:id', {
    schema: {
      tags: TAGS, summary: 'Poll a checkout transaction (payment status)',
      params: IntentParamsSchema,
    },
  }, async (req) => {
    const data = await payments.getIntent(req.tenant, req.params.id)
    return { data }
  })
}
