import { constructWebhookEvent, handleWebhookEvent } from '../services/webhook.service.js'
import { AppError } from '@apphub/platform-sdk/errors'
import { logger } from '../lib/logger.js'

export async function webhookRoutes(fastify) {
  // POST /v1/payments/webhooks/stripe — public (no JWT). Signature is the auth.
  fastify.post('/stripe', {
    config: { public: true, rawBody: true },
    schema: {
      tags: ['payments'],
      summary: 'Stripe webhook receiver (signature-verified)',
    },
  }, async (req, reply) => {
    const signature = req.headers['stripe-signature']
    if (!signature || typeof signature !== 'string') {
      throw new AppError('MISSING_SIGNATURE', 'Missing Stripe-Signature header', 400)
    }

    let event
    try {
      // Mandatory signature verification (CLAUDE.md §5).
      event = await constructWebhookEvent(req.rawBody, signature)
    } catch (err) {
      logger.warn({ err }, 'Webhook signature verification failed')
      throw new AppError('INVALID_SIGNATURE', 'Webhook signature verification failed', 400)
    }

    // Respond 200 immediately to avoid Stripe's 30s timeout, then process.
    reply.send({ received: true })
    handleWebhookEvent(event).catch((err) => {
      logger.error({ err, eventId: event.id, type: event.type }, 'Webhook processing error')
    })
  })
}
