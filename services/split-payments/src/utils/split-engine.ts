import type { SplitRule, SplitSimulation } from '../types/index.js'
import { ValidationError } from './errors.js'

/** Stripe fee: 2.9% + 30 cents (EUR/USD). Configurable per region. */
const STRIPE_FEE_PERCENT = 0.029
const STRIPE_FEE_FIXED = 30 // in smallest currency unit

/**
 * Calculate Stripe's processing fee for a given amount.
 * Amount is in smallest currency unit (cents).
 */
export function calculateStripeFee(amount: number): number {
  return Math.round(amount * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED)
}

/**
 * Calculate the platform's application fee (retained before distributing to recipients).
 * Uses integer arithmetic to avoid floating-point errors.
 */
export function calculatePlatformFee(netAmount: number, platformFeePercent: number): number {
  return Math.round((netAmount * platformFeePercent) / 100)
}

/**
 * Calculate the amount each recipient receives.
 * Uses integer arithmetic throughout to avoid floating-point drift.
 *
 * All amounts are in smallest currency unit (e.g. cents).
 */
export function calculateRecipientAmounts(
  netAfterPlatformFee: number,
  rule: Pick<SplitRule, 'recipients' | 'platformFeePercent'>,
): Array<{ accountId: string; label: string; percentage: number; amount: number }> {
  const recipients = rule.recipients
  let distributed = 0
  const result = []

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i]!
    let amount: number

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
export function simulateSplit(
  grossAmount: number,
  currency: string,
  rule: SplitRule,
): SplitSimulation {
  if (grossAmount <= 0) {
    throw new ValidationError('Amount must be greater than zero')
  }

  const stripeFee = calculateStripeFee(grossAmount)
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
export function calculateProportionalRefunds(
  originalAmount: number,
  refundAmount: number,
  transfers: Array<{ transferId: string; amount: number }>,
): Array<{ transferId: string; refundAmount: number }> {
  if (refundAmount > originalAmount) {
    throw new ValidationError('Refund amount cannot exceed original payment amount')
  }

  const ratio = refundAmount / originalAmount
  let distributed = 0
  const result = []

  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i]!
    let amount: number

    if (i === transfers.length - 1) {
      amount = refundAmount - distributed
    } else {
      amount = Math.round(transfer.amount * ratio)
      distributed += amount
    }

    // Never refund more than the original transfer amount
    result.push({
      transferId: transfer.transferId,
      refundAmount: Math.min(amount, transfer.amount),
    })
  }

  return result
}
