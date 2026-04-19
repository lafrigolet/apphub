import { pool, withTenant } from '../lib/db.js'
import { stripe } from '../lib/stripe.js'
import { checkIdempotency, storeIdempotency } from '../lib/redis.js'
import * as paymentRepo from '../repositories/payment.repository.js'
import * as splitRuleRepo from '../repositories/split-rule.repository.js'
import { simulateSplit, calculateRecipientAmounts, calculateProportionalRefunds } from '../utils/split-engine.js'
import { StripeError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'

export async function createPaymentIntent(ctx, input) {
  // Check idempotency
  const cached = await checkIdempotency(input.idempotencyKey)
  if (cached) {
    return JSON.parse(cached)
  }

  const client = await pool.connect()
  try {
    // Load split rule
    const rule = await splitRuleRepo.findSplitRuleById(client, ctx, input.splitRuleId)

    // Calculate split
    const simulation = simulateSplit(input.amount, input.currency, rule)
    const primaryRecipient = simulation.recipients[0]

    if (!primaryRecipient) {
      throw new StripeError('Split rule has no recipients')
    }

    // Create Stripe PaymentIntent
    let stripeIntent
    try {
      stripeIntent = await stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency,
          application_fee_amount: simulation.platformFee,
          transfer_data: {
            destination: primaryRecipient.accountId,
          },
          metadata: {
            tenant_id: ctx.tenantId,
            sub_tenant_id: ctx.subTenantId ?? '',
            split_rule_id: input.splitRuleId,
            ...input.metadata,
          },
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: `pi_${input.idempotencyKey}` },
      )
    } catch (err) {
      logger.error({ err }, 'Stripe PaymentIntent creation failed')
      throw new StripeError('Failed to create payment intent', err)
    }

    // Persist payment record
    const payment = await paymentRepo.insertPayment(client, ctx, {
      tenantId: ctx.tenantId,
      subTenantId: ctx.subTenantId,
      stripePaymentIntentId: stripeIntent.id,
      amount: input.amount,
      currency: input.currency,
      status: stripeIntent.status,
      splitRuleId: input.splitRuleId,
      merchantAccountId: input.merchantAccountId,
      platformFee: simulation.platformFee,
      metadata: input.metadata ?? {},
    })

    if (simulation.recipients.length > 1) {
      logger.info(
        { paymentId: payment.id, recipientCount: simulation.recipients.length },
        'Multi-recipient split — additional transfers will be created on payment.succeeded webhook',
      )
    }

    const result = {
      clientSecret: stripeIntent.client_secret,
      paymentId: payment.id,
    }

    await storeIdempotency(input.idempotencyKey, result)
    return result
  } finally {
    client.release()
  }
}

export async function createAdditionalTransfers(stripePaymentIntentId, chargeId) {
  const client = await pool.connect()
  try {
    const payment = await paymentRepo.findPaymentByStripeId(client, stripePaymentIntentId)
    if (!payment) {
      logger.warn({ stripePaymentIntentId }, 'Payment not found for transfer creation')
      return
    }

    // Reload split rule to get all recipients
    const { rows } = await client.query(
      `SELECT recipients, platform_fee_percent FROM payments.split_rules WHERE id = $1`,
      [payment.splitRuleId],
    )
    const ruleRow = rows[0]
    if (!ruleRow) return

    const recipients = JSON.parse(ruleRow.recipients)

    // Skip first recipient (already handled by transfer_data.destination)
    const additionalRecipients = recipients.slice(1)
    if (additionalRecipients.length === 0) return

    const stripeFeeApprox = Math.round(payment.amount * 0.029 + 30)
    const netAmount = payment.amount - stripeFeeApprox - payment.platformFee
    const amounts = calculateRecipientAmounts(netAmount, {
      platformFeePercent: parseFloat(ruleRow.platform_fee_percent),
      recipients,
    })

    for (const recipient of additionalRecipients) {
      const recipientAmount = amounts.find((a) => a.accountId === recipient.accountId)
      if (!recipientAmount || recipientAmount.amount <= 0) continue

      try {
        await stripe.transfers.create(
          {
            amount: recipientAmount.amount,
            currency: payment.currency,
            destination: recipient.accountId,
            source_transaction: chargeId,
            metadata: {
              payment_id: payment.id,
              tenant_id: payment.tenantId,
              recipient_label: recipient.label,
            },
          },
          { idempotencyKey: `tr_${payment.id}_${recipient.accountId}` },
        )
        logger.info({ accountId: recipient.accountId, amount: recipientAmount.amount }, 'Transfer created')
      } catch (err) {
        logger.error({ err, accountId: recipient.accountId }, 'Failed to create transfer')
      }
    }
  } finally {
    client.release()
  }
}

export async function getPayment(ctx, id) {
  const client = await pool.connect()
  try {
    return paymentRepo.findPaymentById(client, ctx, id)
  } finally {
    client.release()
  }
}

export async function listPayments(ctx, limit = 20, cursor) {
  const client = await pool.connect()
  try {
    const items = await paymentRepo.listPayments(client, ctx, limit + 1, cursor)
    const hasMore = items.length > limit
    const data = hasMore ? items.slice(0, limit) : items
    return {
      data,
      cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
      hasMore,
    }
  } finally {
    client.release()
  }
}

export async function createRefund(ctx, input) {
  const cached = await checkIdempotency(input.idempotencyKey)
  if (cached) return JSON.parse(cached)

  const client = await pool.connect()
  try {
    const payment = await paymentRepo.findPaymentById(client, ctx, input.paymentId)
    const refundAmount = input.amount ?? payment.amount

    // Get existing transfers for this payment
    const transfers = await stripe.transfers.list({
      transfer_group: payment.stripePaymentIntentId,
    })

    // Refund the PaymentIntent
    let stripeRefund
    try {
      stripeRefund = await stripe.refunds.create(
        {
          payment_intent: payment.stripePaymentIntentId,
          amount: refundAmount,
          reason: input.reason,
        },
        { idempotencyKey: `ref_${input.idempotencyKey}` },
      )
    } catch (err) {
      throw new StripeError('Failed to create refund', err)
    }

    // Proportionally reverse each transfer
    if (transfers.data.length > 0) {
      const proportionalRefunds = calculateProportionalRefunds(
        payment.amount,
        refundAmount,
        transfers.data.map((t) => ({ transferId: t.id, amount: t.amount })),
      )

      for (const { transferId, refundAmount: reverseAmount } of proportionalRefunds) {
        if (reverseAmount <= 0) continue
        try {
          await stripe.transfers.createReversal(
            transferId,
            { amount: reverseAmount },
            { idempotencyKey: `rev_${input.idempotencyKey}_${transferId}` },
          )
        } catch (err) {
          logger.error({ err, transferId }, 'Failed to reverse transfer')
        }
      }
    }

    const result = { refundId: stripeRefund.id }
    await storeIdempotency(input.idempotencyKey, result)
    return result
  } finally {
    client.release()
  }
}
