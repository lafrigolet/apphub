import { stripe } from '../lib/stripe.js'
import { env } from '../lib/env.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as txRepo from '../repositories/transaction.repository.js'
import { ValidationError } from '../utils/errors.js'

export async function webhookRoutes(fastify) {
  fastify.post('/stripe', { config: { rawBody: true, public: true } }, async (req, reply) => {
    const sig = req.headers['stripe-signature']
    let event

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, env.YOGA_STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      logger.warn({ err }, 'Stripe webhook signature verification failed')
      throw new ValidationError('Invalid Stripe signature')
    }

    logger.info({ type: event.type }, 'Stripe webhook received')

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const tenantId = session.metadata.tenantId
      const subTenantId = session.metadata.subTenantId || null

      if (!tenantId) {
        logger.error({ sessionId: session.id }, 'Webhook missing tenantId in metadata')
        return reply.send({ received: true })
      }

      await withTenantTransaction(tenantId, subTenantId, async (client) => {
        const tx = await txRepo.completeTransaction(client, session.id)
        if (tx) {
          await publish({
            type: 'payment.completed',
            payload: {
              transactionId: tx.id,
              userId: session.metadata.userId,
              bonusTypeId: session.metadata.bonusTypeId,
              amountEur: tx.amount_eur,
              tenantId,
              subTenantId,
            },
          })
          logger.info({ txId: tx.id }, 'Payment completed and event published')
        }
      })
    }

    if (event.type === 'checkout.session.expired') {
      logger.info({ sessionId: event.data.object.id }, 'Checkout session expired')
    }

    return reply.send({ received: true })
  })
}
