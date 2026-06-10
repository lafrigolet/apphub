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

// ── Terminal (Tap to Pay) ────────────────────────────────────────────────────

export const CreateTerminalIntentSchema = z.object({
  /** Amount in the smallest currency unit (e.g. cents) */
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).toLowerCase().default('eur'),
  /** Optional idempotency key — dedupes retried "Cobrar" taps (24h Redis TTL) */
  idempotencyKey: z.string().min(1).max(255).optional(),
  /** Free-form metadata forwarded to Stripe (string values only) */
  metadata: z.record(z.string()).optional(),
})

// ── Checkout sessions (QR / payment link) ───────────────────────────────────
// Cobro "desde el móvil del cajero": se crea una Stripe Checkout Session hosted
// y el CLIENTE paga en SU propio dispositivo (escaneando el QR del `url`). No es
// card-present, así que no entra en CPoC/MPoC ni necesita hardware. Sin
// `paymentMethodTypes` Checkout ofrece los métodos habilitados en la cuenta
// (tarjeta, wallets y, en ES, Bizum).

export const CreateCheckoutSessionSchema = z.object({
  /** Amount in the smallest currency unit (e.g. cents) */
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).toLowerCase().default('eur'),
  /** Line-item label shown on the hosted page (e.g. "Mesa 4" / "Pedido #123") */
  description: z.string().min(1).max(255).optional(),
  /** Where Stripe redirects the payer after success/cancel (defaults via env) */
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  /** Restrict methods (e.g. ['bizum']). Omit → account-configured methods. */
  paymentMethodTypes: z.array(z.string().min(1)).min(1).optional(),
  /** Minutes until the session expires (Stripe allows 30min–24h). */
  expiresInMinutes: z.coerce.number().int().min(30).max(1440).default(30),
  /** Optional idempotency key — dedupes retried "Generar QR" taps (24h Redis TTL) */
  idempotencyKey: z.string().min(1).max(255).optional(),
  /** Free-form metadata forwarded to Stripe (string values only) */
  metadata: z.record(z.string()).optional(),
})

// ── Refunds ──────────────────────────────────────────────────────────────────

export const CreateRefundSchema = z.object({
  /** Amount to refund in the smallest currency unit. Defaults to remaining. */
  amount: z.number().int().positive().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
  /** Idempotency key — prevents duplicate refunds on retry */
  idempotencyKey: z.string().min(1).max(255),
})
