import { stripe } from '../lib/stripe.js'
import { withTenantTransaction, setTenantContext, pool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as txRepo from '../repositories/transaction.repository.js'
import { requireRole } from '../plugins/auth.js'
import { NotFoundError } from '../utils/errors.js'

export async function adminPaymentRoutes(fastify) {
  fastify.post('/:id/refund', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { tenantId, subTenantId } = req.user
    const client = await pool.connect()
    let tx
    try {
      await setTenantContext(client, tenantId, subTenantId)
      tx = await txRepo.findByProviderTxId(client, req.params.id)
    } finally {
      client.release()
    }

    if (!tx) throw new NotFoundError('Transaction')

    const session = await stripe.checkout.sessions.retrieve(tx.provider_tx_id)
    await stripe.refunds.create({ payment_intent: session.payment_intent })

    await withTenantTransaction(tenantId, subTenantId, async (client) => {
      await txRepo.refundTransaction(client, tx.id, tenantId)
    })

    await publish({ type: 'payment.refunded', payload: { transactionId: tx.id, userId: tx.user_id, tenantId, subTenantId } })
    logger.info({ txId: tx.id }, 'Payment refunded')

    return reply.send({ data: { success: true } })
  })
}
