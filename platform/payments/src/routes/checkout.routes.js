import { CreateCheckoutSessionSchema, IntentParamsSchema } from '../schemas/index.js'
import * as checkout from '../services/checkout.service.js'
import * as payments from '../services/payment.service.js'
import { getPayLink } from '../lib/redis.js'

const TAGS = ['payments · checkout']

// Public base for short pay-links. Set PAYMENTS_PUBLIC_BASE_URL to a host the
// customer's phone can reach (e.g. https://hulkstein.com) to enable the
// shortener; unset → the QR encodes the raw Stripe URL (local dev default).
function publicBase() {
  const b = process.env.PAYMENTS_PUBLIC_BASE_URL
  return b ? b.replace(/\/+$/, '') : null
}

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
    const data = await checkout.createCheckoutSession(req.tenant, req.body, { publicBase: publicBase() })
    return reply.status(201).send({ data })
  })

  // GET /v1/payments/pay/:code — PUBLIC short pay-link. Resolves the opaque code
  // to the hosted Checkout URL and 302-redirects. No auth: the payer isn't a
  // platform user; the code is the unguessable capability.
  fastify.get('/pay/:code', {
    config: { public: true },
    schema: { hide: true },
  }, async (req, reply) => {
    const url = await getPayLink(req.params.code)
    if (!url) {
      return reply.status(404).type('text/html')
        .send('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>Enlace de pago no válido o caducado</h1></body>')
    }
    return reply.redirect(url, 302)
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
