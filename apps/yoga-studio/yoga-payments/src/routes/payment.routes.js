import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { stripe } from '../lib/stripe.js'
import { withTenantTransaction, setTenantContext, pool } from '../lib/db.js'
import * as txRepo from '../repositories/transaction.repository.js'

const checkoutBody = z.object({
  bonusTypeId: z.string().uuid(),
  priceEur: z.number().positive(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
})

export async function paymentRoutes(fastify) {
  fastify.post('/checkout', { schema: { body: checkoutBody } }, async (req, reply) => {
    const { bonusTypeId, priceEur, successUrl, cancelUrl } = req.body
    const { userId, tenantId, subTenantId } = req.user

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Yoga Studio Bonus' },
          unit_amount: Math.round(priceEur * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, bonusTypeId, tenantId, subTenantId: subTenantId ?? '' },
    })

    await withTenantTransaction(tenantId, subTenantId, async (client) => {
      await txRepo.createTransaction(client, {
        id: uuidv4(),
        userId,
        bonusTypeId,
        provider: 'stripe',
        providerTxId: session.id,
        amountEur: priceEur,
        tenantId,
        subTenantId,
      })
    })

    return reply.status(201).send({ data: { checkoutUrl: session.url, sessionId: session.id } })
  })

  fastify.get('/', async (req, reply) => {
    const { userId, tenantId, subTenantId } = req.user
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const transactions = await txRepo.listByUser(client, userId, tenantId)
      return reply.send({ data: transactions })
    } finally {
      client.release()
    }
  })
}
