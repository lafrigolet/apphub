import { Router } from 'express'
import { asyncHandler } from '../middleware/error.middleware.js'
import { constructWebhookEvent, handleWebhookEvent } from '../services/webhook.service.js'
import { AppError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'

export const webhookRouter = Router()

// POST /v1/webhooks/stripe
// NOTE: This route must receive the raw request body (Buffer), NOT the parsed JSON.
// The express.raw() middleware is applied in app.ts specifically for this path.
webhookRouter.post(
  '/stripe',
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature']

    if (!signature || typeof signature !== 'string') {
      throw new AppError('MISSING_SIGNATURE', 'Missing Stripe-Signature header', 400)
    }

    let event
    try {
      event = constructWebhookEvent(req.body as Buffer, signature)
    } catch (err) {
      logger.warn({ err }, 'Webhook signature verification failed')
      throw new AppError('INVALID_SIGNATURE', 'Webhook signature verification failed', 400)
    }

    // Respond immediately — process asynchronously
    res.json({ received: true })

    // Process in background (errors logged, not thrown back to Stripe)
    handleWebhookEvent(event).catch((err) => {
      logger.error({ err, eventId: event.id, type: event.type }, 'Webhook processing error')
    })
  }),
)
