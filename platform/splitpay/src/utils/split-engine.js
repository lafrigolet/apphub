import { ValidationError } from './errors.js'

/** Default Stripe fee: 2.9% + 30 cents (EUR/USD). Overridable per platform/region. */
export const DEFAULT_STRIPE_FEE_PERCENT = 0.029
export const DEFAULT_STRIPE_FEE_FIXED = 30 // in smallest currency unit

/**
 * Resolve the fee config to use, falling back to the EUR/USD defaults.
 * `feeConfig` may carry `percent` (fraction, e.g. 0.014) and/or `fixed` (cents).
 */
function resolveFeeConfig(feeConfig) {
  const percent = Number.isFinite(feeConfig?.percent) ? feeConfig.percent : DEFAULT_STRIPE_FEE_PERCENT
  const fixed = Number.isFinite(feeConfig?.fixed) ? feeConfig.fixed : DEFAULT_STRIPE_FEE_FIXED
  return { percent, fixed }
}

/**
 * Calculate Stripe's processing fee for a given amount.
 * Amount is in smallest currency unit (cents). The fee rate is configurable
 * per platform/region (priority #9) — pass `{ percent, fixed }`; omit for the
 * EUR/USD default of 2.9% + 30c.
 */
export function calculateStripeFee(amount, feeConfig) {
  const { percent, fixed } = resolveFeeConfig(feeConfig)
  return Math.round(amount * percent + fixed)
}

/**
 * Calculate the platform's application fee (retained before distributing to recipients).
 * Uses integer arithmetic to avoid floating-point errors.
 */
export function calculatePlatformFee(netAmount, platformFeePercent) {
  return Math.round((netAmount * platformFeePercent) / 100)
}

/**
 * Calculate the amount each recipient receives.
 * Uses integer arithmetic throughout to avoid floating-point drift.
 *
 * All amounts are in smallest currency unit (e.g. cents).
 */
export function calculateRecipientAmounts(netAfterPlatformFee, rule) {
  const recipients = rule.recipients
  let distributed = 0
  const result = []

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i]
    let amount

    if (i === recipients.length - 1) {
      // Last recipient gets the remainder to avoid rounding loss
      amount = netAfterPlatformFee - distributed
    } else {
      amount = Math.round((netAfterPlatformFee * recipient.percentage) / 100)
      distributed += amount
    }

    result.push({
      accountId: recipient.accountId,
      label: recipient.label,
      percentage: recipient.percentage,
      amount,
    })
  }

  return result
}

/**
 * Simulate a full split for a given amount and rule.
 * Used by the /simulate endpoint to show merchants the breakdown before charging.
 */
export function simulateSplit(grossAmount, currency, rule, feeConfig) {
  if (grossAmount <= 0) {
    throw new ValidationError('Amount must be greater than zero')
  }

  const stripeFee = calculateStripeFee(grossAmount, feeConfig)
  const netAmount = grossAmount - stripeFee

  if (netAmount <= 0) {
    throw new ValidationError('Amount too small — net amount after Stripe fee would be negative')
  }

  const platformFee = calculatePlatformFee(netAmount, rule.platformFeePercent)
  const netAfterPlatformFee = netAmount - platformFee

  const recipients = calculateRecipientAmounts(netAfterPlatformFee, rule)

  return {
    grossAmount,
    currency,
    stripeFee,
    netAmount,
    platformFee,
    recipients,
  }
}

/**
 * Calculate the proportional refund amount for each Transfer, given a partial refund.
 * Ensures refunds never exceed the original transfer amount.
 */
export function calculateProportionalRefunds(originalAmount, refundAmount, transfers) {
  if (refundAmount > originalAmount) {
    throw new ValidationError('Refund amount cannot exceed original payment amount')
  }

  const ratio = refundAmount / originalAmount
  const totalToReverse = Math.round(transfers.reduce((sum, t) => sum + t.amount, 0) * ratio)

  let distributed = 0
  const result = []

  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i]
    let amount

    if (i === transfers.length - 1) {
      amount = totalToReverse - distributed
    } else {
      amount = Math.round(transfer.amount * ratio)
      distributed += amount
    }

    result.push({
      transferId: transfer.transferId,
      refundAmount: Math.min(amount, transfer.amount),
    })
  }

  return result
}
