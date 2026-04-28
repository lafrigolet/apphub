import { stripe } from '../lib/stripe.js'
import { pool } from '../lib/db.js'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import * as paymentRepo from '../repositories/payment.repository.js'
import { createAdditionalTransfers } from './payment.service.js'
import { syncAccountFromStripe } from './connect-account.service.js'

export function constructWebhookEvent(payload, signature) {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    env.SPLITPAY_STRIPE_WEBHOOK_SECRET,
  )
}

export async function handleWebhookEvent(event) {
  logger.info({ eventId: event.id, type: event.type }, 'Processing webhook event')

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object)
      break

    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object)
      break

    case 'payment_intent.canceled':
      await handlePaymentIntentCanceled(event.data.object)
      break

    case 'account.updated':
      await handleAccountUpdated(event.data.object)
      break

    case 'charge.dispute.created':
      await handleDisputeCreated(event.data.object)
      break

    case 'charge.dispute.closed':
      await handleDisputeClosed(event.data.object)
      break

    default:
      logger.debug({ type: event.type }, 'Unhandled webhook event type')
  }
}

async function handlePaymentIntentSucceeded(intent) {
  const client = await pool.connect()
  try {
    await paymentRepo.updatePaymentStatus(client, intent.id, 'succeeded')

    // Create additional transfers for multi-recipient splits
    const chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id

    if (chargeId) {
      await createAdditionalTransfers(intent.id, chargeId)
    }

    logger.info({ intentId: intent.id }, 'PaymentIntent succeeded — status updated')
  } finally {
    client.release()
  }
}

async function handlePaymentIntentFailed(intent) {
  const client = await pool.connect()
  try {
    await paymentRepo.updatePaymentStatus(client, intent.id, 'failed')
    logger.info({ intentId: intent.id }, 'PaymentIntent failed — status updated')
  } finally {
    client.release()
  }
}

async function handlePaymentIntentCanceled(intent) {
  const client = await pool.connect()
  try {
    await paymentRepo.updatePaymentStatus(client, intent.id, 'canceled')
    logger.info({ intentId: intent.id }, 'PaymentIntent canceled — status updated')
  } finally {
    client.release()
  }
}

async function handleAccountUpdated(account) {
  try {
    await syncAccountFromStripe(account.id)
  } catch (err) {
    logger.error({ err, accountId: account.id }, 'Failed to sync account from webhook')
  }
}

async function handleDisputeCreated(dispute) {
  const client = await pool.connect()
  try {
    await client.query(
      `INSERT INTO payments.disputes
         (stripe_dispute_id, stripe_charge_id, amount, currency, reason, status, due_by)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))
       ON CONFLICT (stripe_dispute_id) DO NOTHING`,
      [
        dispute.id,
        dispute.charge,
        dispute.amount,
        dispute.currency,
        dispute.reason,
        dispute.status,
        dispute.evidence_details?.due_by ?? null,
      ],
    )
    logger.warn({ disputeId: dispute.id, chargeId: dispute.charge }, 'Dispute created')
  } finally {
    client.release()
  }
}

async function handleDisputeClosed(dispute) {
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE payments.disputes SET status = $1, updated_at = now()
       WHERE stripe_dispute_id = $2`,
      [dispute.status, dispute.id],
    )
    logger.info({ disputeId: dispute.id, status: dispute.status }, 'Dispute closed')
  } finally {
    client.release()
  }
}
