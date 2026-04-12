import { z } from 'zod'

// ── Split rules ────────────────────────────────────────────────────────────

export const SplitRecipientSchema = z.object({
  /** Stripe Connect account ID */
  accountId: z.string().startsWith('acct_'),
  /** Percentage of net amount (after Stripe fee) to transfer. 0–100 */
  percentage: z.number().min(0).max(100),
  /** Human-readable label for this recipient */
  label: z.string().min(1).max(100),
})

export const CreateSplitRuleSchema = z.object({
  name: z.string().min(1).max(100),
  /** Platform fee percentage retained before distributing to recipients */
  platformFeePercent: z.number().min(0).max(100),
  recipients: z.array(SplitRecipientSchema).min(1),
})
  .refine(
    (d) => {
      const recipientTotal = d.recipients.reduce((sum, r) => sum + r.percentage, 0)
      return Math.abs(recipientTotal + d.platformFeePercent - 100) < 0.01
    },
    { message: 'platformFeePercent + sum of recipient percentages must equal 100' },
  )

// ── Payments ───────────────────────────────────────────────────────────────

export const CreatePaymentIntentSchema = z.object({
  /** Amount in smallest currency unit (e.g. cents) */
  amount: z.number().int().positive(),
  currency: z.string().length(3).toLowerCase(),
  /** ID of the SplitRule to apply */
  splitRuleId: z.string().uuid(),
  /** Stripe Connect account that is the primary merchant */
  merchantAccountId: z.string().startsWith('acct_'),
  /** Idempotency key supplied by the caller */
  idempotencyKey: z.string().min(1).max(255),
  /** Metadata forwarded to Stripe */
  metadata: z.record(z.string()).optional(),
  /** URL to redirect to after payment (for redirect-based flows) */
  returnUrl: z.string().url().optional(),
})

// ── Refunds ────────────────────────────────────────────────────────────────

export const CreateRefundSchema = z.object({
  paymentId: z.string().uuid(),
  /** Amount to refund in smallest currency unit. Defaults to full amount if omitted */
  amount: z.number().int().positive().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
  idempotencyKey: z.string().min(1).max(255),
})

// ── Connect accounts ───────────────────────────────────────────────────────

export const CreateConnectAccountSchema = z.object({
  email: z.string().email(),
  businessType: z.enum(['individual', 'company', 'non_profit']).default('company'),
  country: z.string().length(2).toUpperCase(),
  /** URL to redirect the merchant after completing onboarding */
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
})
