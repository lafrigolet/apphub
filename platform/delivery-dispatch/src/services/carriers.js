// External aggregator stubs (Glovo, Uber Direct, Stuart).
//
// Credentials live (encrypted) in platform_delivery_dispatch.settings. The
// outbound API calls (create order, fetch ETA) are NOT implemented yet — only
// the inbound side is: each provider posts status webhooks that we verify by
// HMAC and map onto our internal FSM status.
//
// To add real outbound calls later, implement createExternalDelivery() per
// provider using the stored client credentials.
import crypto from 'node:crypto'

export const PROVIDERS = ['uber', 'glovo', 'stuart']

// Each provider maps its own lifecycle vocabulary onto our internal FSM status.
// Unmapped statuses return null (ignored — no transition).
const STATUS_MAP = {
  uber: {
    pickup_started:    'picked_up',
    pickup_complete:   'picked_up',
    dropoff_started:   'picked_up',
    delivered:         'delivered',
    dropoff_complete:  'delivered',
    canceled:          'cancelled',
    cancelled:         'cancelled',
    returned:          'failed',
    failed:            'failed',
  },
  glovo: {
    PICKED_UP:   'picked_up',
    DELIVERED:   'delivered',
    CANCELED:    'cancelled',
    CANCELLED:   'cancelled',
    FAILED:      'failed',
  },
  stuart: {
    picking:     'picked_up',
    delivering:  'picked_up',
    delivered:   'delivered',
    cancelled:   'cancelled',
    voided:      'cancelled',
    failed:      'failed',
  },
}

// settings key that stores the HMAC secret for each provider's inbound webhook.
const WEBHOOK_SECRET_KEY = {
  uber:   'uber_webhook_secret',
  glovo:  'glovo_webhook_secret',
  stuart: 'stuart_webhook_secret',
}

// settings key that stores the per-provider "enabled" flag.
const ENABLED_KEY = {
  uber:   'uber_enabled',
  glovo:  'glovo_enabled',
  stuart: 'stuart_enabled',
}

export function isProvider(p) {
  return PROVIDERS.includes(p)
}

export function webhookSecretKey(provider) {
  return WEBHOOK_SECRET_KEY[provider] ?? null
}

export function enabledKey(provider) {
  return ENABLED_KEY[provider] ?? null
}

/**
 * Map an aggregator-reported status to our internal FSM status, or null when
 * there is no meaningful transition.
 */
export function mapCarrierStatus(provider, externalStatus) {
  const table = STATUS_MAP[provider]
  if (!table || externalStatus == null) return null
  return table[externalStatus] ?? table[String(externalStatus).toLowerCase()] ?? null
}

/**
 * Constant-time HMAC-SHA256 verification of a webhook signature.
 * `signature` is the hex digest sent by the provider over the raw body.
 */
export function verifyWebhookSignature(secret, rawBody, signature) {
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  let b
  try { b = Buffer.from(String(signature).replace(/^sha256=/i, ''), 'hex') } catch { return false }
  if (a.length !== b.length || a.length === 0) return false
  return crypto.timingSafeEqual(a, b)
}
