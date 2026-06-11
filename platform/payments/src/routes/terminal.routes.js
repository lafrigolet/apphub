import { CreateTerminalIntentSchema } from '../schemas/index.js'
import * as terminal from '../services/terminal.service.js'

const TAGS = ['payments · terminal']

// Tap to Pay (card-present) endpoints consumed by the native Stripe Terminal
// SDK in the Expo TPV app. Registered inside the encapsulated `payments` scope
// (src/index.js), so they inherit req.tenant, zod compilers and the Stripe
// error handler. Authenticated like the rest of /v1/payments (appGuard).
export async function terminalRoutes(fastify) {
  // POST /v1/payments/terminal/connection-token — SDK tokenProvider
  fastify.post('/connection-token', {
    schema: { tags: TAGS, summary: 'Issue a Stripe Terminal ConnectionToken (+ location id)' },
  }, async (req, reply) => {
    const data = await terminal.createConnectionToken(req.tenant)
    return reply.status(201).send({ data })
  })

  // POST /v1/payments/terminal/intents — create a card_present PaymentIntent
  fastify.post('/intents', {
    schema: {
      tags: TAGS, summary: 'Create a card-present (Tap to Pay) PaymentIntent',
      body: CreateTerminalIntentSchema,
    },
  }, async (req, reply) => {
    const data = await terminal.createTerminalPaymentIntent(req.tenant, req.body)
    return reply.status(201).send({ data })
  })
}
