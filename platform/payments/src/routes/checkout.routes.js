import { CreateCheckoutSessionSchema, CheckoutSessionParamsSchema } from '../schemas/index.js'
import * as checkout from '../services/checkout.service.js'

const TAGS = ['payments · checkout']

// Hosted Checkout Sessions para el target web del TPV (QR). Registradas dentro
// del scope `payments` (heredan req.tenant + zod + Stripe error handler).
export async function checkoutRoutes(fastify) {
  // POST /v1/payments/checkout-sessions — crea la sesión y devuelve la URL (→ QR)
  fastify.post('/', {
    schema: { tags: TAGS, summary: 'Create a hosted Checkout Session (web/QR charge)', body: CreateCheckoutSessionSchema },
  }, async (req, reply) => {
    const data = await checkout.createCheckoutSession(req.tenant, req.body)
    return reply.status(201).send({ data })
  })

  // GET /v1/payments/checkout-sessions/:id — estado (polling: paid → recibo emitido)
  fastify.get('/:id', {
    schema: { tags: TAGS, summary: 'Get a Checkout Session status', params: CheckoutSessionParamsSchema },
  }, async (req) => {
    const data = await checkout.getCheckoutSession(req.tenant, req.params.id)
    return { data }
  })
}
