import { pool, withTenant } from '../lib/db.js'
import { stripe } from '../lib/stripe.js'
import { checkIdempotency, storeIdempotency, redis } from '../lib/redis.js'
import { publish } from '@apphub/platform-sdk/redis'
import * as paymentRepo from '../repositories/payment.repository.js'
import * as splitRuleRepo from '../repositories/split-rule.repository.js'
import * as configRepo from '../repositories/config.repository.js'
import { simulateSplit, calculateStripeFee, calculateRecipientAmounts, calculateProportionalRefunds } from '../utils/split-engine.js'
import { StripeError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'

// Publica un evento splitpay.* en `${appId}.events` para que la app de origen
// reaccione (marcar pedido reembolsado, alertar al merchant de una transferencia
// fallida, …). El appId viene del metadata propagado al crear el PaymentIntent.
// Pérdida silenciosa controlada: sin appId no hay a quién notificar.
async function emit(appId, type, payload) {
  if (!appId) {
    logger.warn({ type }, 'Skipping splitpay event emit — no app_id in payment metadata')
    return
  }
  try {
    await publish(redis, appId, { type, payload })
  } catch (err) {
    logger.error({ err, type, appId }, 'Failed to publish splitpay event')
  }
}

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

    // Calculate split with the configurable Stripe fee (priority #9 — falls
    // back to the EUR/USD default when no fee config row exists).
    const feeConfig = await configRepo.getFeeConfig(client)
    const simulation = simulateSplit(input.amount, input.currency, rule, feeConfig)
    const primaryRecipient = simulation.recipients[0]

    if (!primaryRecipient) {
      throw new StripeError('Split rule has no recipients')
    }

    // Explicit transfer_group: ties the primary transfer_data transfer AND every
    // additional transfer to this payment, so createRefund lists exactly the
    // transfers that belong here (priority #1 — integridad de reversals).
    const transferGroup = `pi_${input.idempotencyKey}`

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
          transfer_group: transferGroup,
          metadata: {
            tenant_id: ctx.tenantId,
            sub_tenant_id: ctx.subTenantId ?? '',
            split_rule_id: input.splitRuleId,
            app_id: ctx.appId ?? '',
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
      transferGroup,
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

    // Use the configurable Stripe fee (priority #9) so the additional-transfer
    // net-amount math matches the platform's real negotiated rate / region,
    // not a hardcoded 2.9% + 30c.
    const feeConfig = await configRepo.getFeeConfig(client)
    const stripeFeeApprox = calculateStripeFee(payment.amount, feeConfig)
    const netAmount = payment.amount - stripeFeeApprox - payment.platformFee
    const amounts = calculateRecipientAmounts(netAmount, {
      platformFeePercent: parseFloat(ruleRow.platform_fee_percent),
      recipients,
    })

    const appId = payment.metadata?.app_id || null

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
            transfer_group: payment.transferGroup ?? undefined,
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
        // priority #4 — notifica a la app de origen para que pueda alertar al
        // merchant / reintentar. La transferencia restante sigue su curso.
        await emit(appId, 'splitpay.transfer.failed', {
          paymentId:   payment.id,
          accountId:   recipient.accountId,
          amount:      recipientAmount.amount,
          currency:    payment.currency,
          tenantId:    payment.tenantId,
          subTenantId: payment.subTenantId,
          error:       err?.message ?? 'transfer failed',
        })
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

// ── CSV export of transactions (priority #6) ─────────────────────────────────
const CSV_COLUMNS = [
  'id', 'created_at', 'status', 'amount', 'currency', 'platform_fee',
  'merchant_account_id', 'split_rule_id', 'stripe_payment_intent_id', 'transfer_group',
]

// RFC-4180-ish escaping: wrap in quotes and double any embedded quotes when the
// value contains a comma, quote or newline.
function csvCell(value) {
  if (value === null || value === undefined) return ''
  const s = value instanceof Date ? value.toISOString() : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function paymentToCsvRow(p) {
  return [
    p.id, p.createdAt, p.status, p.amount, p.currency, p.platformFee,
    p.merchantAccountId, p.splitRuleId, p.stripePaymentIntentId, p.transferGroup,
  ].map(csvCell).join(',')
}

export async function exportPaymentsCsv(ctx, { from, to, limit } = {}) {
  const client = await pool.connect()
  try {
    const rows = await paymentRepo.listPaymentsForExport(client, ctx, { from, to, limit })
    const header = CSV_COLUMNS.join(',')
    const body = rows.map(paymentToCsvRow).join('\n')
    return body ? `${header}\n${body}\n` : `${header}\n`
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

    // Get existing transfers for this payment. Use the explicit transfer_group
    // recorded at creation (priority #1); fall back to the PaymentIntent id for
    // legacy rows created before the transfer_group column existed.
    const transfers = await stripe.transfers.list({
      transfer_group: payment.transferGroup ?? payment.stripePaymentIntentId,
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
    const appliedReversals = []
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
          appliedReversals.push({ transferId, amount: reverseAmount })
        } catch (err) {
          logger.error({ err, transferId }, 'Failed to reverse transfer')
        }
      }
    }

    // Persist refund + reversals to the ledger (priority #7) — best-effort, a
    // ledger write must never undo a successful Stripe refund.
    try {
      await paymentRepo.insertRefund(client, ctx, {
        transactionId:  payment.id,
        stripeRefundId: stripeRefund.id,
        amount:         refundAmount,
        currency:       payment.currency,
        reason:         input.reason ?? null,
        reversals:      appliedReversals,
        idempotencyKey: input.idempotencyKey,
      })
    } catch (err) {
      logger.error({ err, refundId: stripeRefund.id }, 'Failed to persist refund to ledger')
    }

    // Notify the origin app so it can mark the order refunded / alert the merchant
    // (priority #4).
    await emit(payment.metadata?.app_id || null, 'splitpay.refund.created', {
      refundId:    stripeRefund.id,
      paymentId:   payment.id,
      amount:      refundAmount,
      currency:    payment.currency,
      reason:      input.reason ?? null,
      reversals:   appliedReversals,
      tenantId:    payment.tenantId,
      subTenantId: payment.subTenantId,
    })

    const result = { refundId: stripeRefund.id }
    await storeIdempotency(input.idempotencyKey, result)
    return result
  } finally {
    client.release()
  }
}
