import { constructWebhookEvent, handleWebhookEvent } from '../services/webhook.service.js'
import { AppError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'

export async function webhookRoutes(fastify) {
  // Fastify already handles the content type parsing if we configure it.
  // For Stripe, we need the raw body.
  // We'll use a preParsing hook or just use the raw body from the request.

  fastify.post(
    '/stripe',
    {
      config: {
        rawBody: true,
      },
    },
    async (req, reply) => {
      const signature = req.headers['stripe-signature']

      if (!signature || typeof signature !== 'string') {
        throw new AppError('MISSING_SIGNATURE', 'Missing Stripe-Signature header', 400)
      }

      let event
      try {
        // req.rawBody is provided by a plugin or manual parser
        event = await constructWebhookEvent(req.rawBody, signature)
      } catch (err) {
        logger.warn({ err }, 'Webhook signature verification failed')
        throw new AppError('INVALID_SIGNATURE', 'Webhook signature verification failed', 400)
      }

      // Respond immediately
      reply.send({ received: true })

      // Process in background
      handleWebhookEvent(event).catch((err) => {
        logger.error({ err, eventId: event.id, type: event.type }, 'Webhook processing error')
      })
    },
  )
}
