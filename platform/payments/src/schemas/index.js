import { z } from 'zod'

// ── PaymentIntents — one-shot charge ─────────────────────────────────────────

export const CreatePaymentIntentSchema = z.object({
  /** Amount in the smallest currency unit (e.g. cents) */
  amount: z.number().int().positive(),
  currency: z.string().length(3).toLowerCase().default('eur'),
  /** ID of the end user being charged (for receipts / wallet) */
  userId: z.string().uuid(),
  /** Idempotency key supplied by the caller — dedupes retries (24h Redis TTL) */
  idempotencyKey: z.string().min(1).max(255),
  /** Capture the funds immediately (automatic) or authorize-then-capture (manual) */
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  /** Save the payment method for later off/on-session reuse (3DS/SCA-aware) */
  setupFutureUsage: z.enum(['off_session', 'on_session']).optional(),
  /** Free-form metadata forwarded to Stripe (string values only) */
  metadata: z.record(z.string()).optional(),
})

export const ListIntentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: z.string().optional(),
})

export const IntentParamsSchema = z.object({ id: z.string().uuid() })

export const CaptureIntentSchema = z.object({
  /** Amount to capture (≤ authorized). Defaults to the full authorized amount. */
  amountToCapture: z.number().int().positive().optional(),
})

// ── Refunds ──────────────────────────────────────────────────────────────────

export const CreateRefundSchema = z.object({
  /** Amount to refund in the smallest currency unit. Defaults to remaining. */
  amount: z.number().int().positive().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
  /** Idempotency key — prevents duplicate refunds on retry */
  idempotencyKey: z.string().min(1).max(255),
})
