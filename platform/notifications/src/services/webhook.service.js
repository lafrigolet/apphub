// Provider delivery webhooks — Resend (email) + Twilio (SMS StatusCallback).
//
// Recommendations #5 + #9: turn the providers' async delivery results into
//   (a) suppression-list entries (hard bounces, spam complaints, SMS opt-outs)
//   (b) delivery_status stamps on the original send_log row.
//
// Both handlers are best-effort and idempotent — re-delivered webhooks just
// re-apply the same upsert/update. They never throw to the route (the route
// always 200s so the provider stops retrying).
import crypto from 'node:crypto'
import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as configRepo from '../repositories/config.repository.js'
import * as sendLogRepo from '../repositories/send-log.repository.js'
import { suppress } from './suppression.service.js'

// ── Resend ─────────────────────────────────────────────────────────────────
//
// Resend posts an event { type, data } where type is e.g. 'email.delivered',
// 'email.bounced', 'email.complained', 'email.opened', 'email.clicked'. data
// carries email_id (the provider message id we stored) and to (recipient[s]).
//
// Verification: Resend signs via Svix (svix-id/timestamp/signature headers).
// We don't pull in the svix SDK; instead, when staff configure
// `resend_webhook_secret`, we require an exact match in the `x-webhook-secret`
// header (a simple shared-secret guard). When no secret is configured we accept
// (dev-stub) — same philosophy as the email/SMS dev-stubs. Full Svix HMAC
// verification needs the raw request body, which is captured at the
// platform-core layer (see cross-cutting note in notifications.md).
const RESEND_BOUNCE_TYPES = new Set(['email.bounced'])
const RESEND_COMPLAINT_TYPES = new Set(['email.complained'])
const RESEND_DELIVERY_STATUS = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
}

export async function verifyResendSecret(headerSecret) {
  const client = await pool.connect()
  let configured
  try {
    configured = await configRepo.getValue(client, 'resend_webhook_secret')
  } finally {
    client.release()
  }
  if (!configured) return true // dev-stub: no secret set → accept
  if (!headerSecret) return false
  // Constant-time compare to avoid leaking the secret via timing.
  const a = Buffer.from(String(headerSecret))
  const b = Buffer.from(String(configured))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function recipientsOf(data) {
  const to = data?.to
  if (Array.isArray(to)) return to
  if (typeof to === 'string') return [to]
  return []
}

export async function handleResendEvent(event) {
  const type = event?.type
  if (!type) return { ignored: true }
  const data = event.data ?? {}
  const providerMessageId = data.email_id ?? data.id ?? null

  // Suppress hard bounces and complaints so we never contact the address again.
  if (RESEND_BOUNCE_TYPES.has(type) || RESEND_COMPLAINT_TYPES.has(type)) {
    const reason = RESEND_COMPLAINT_TYPES.has(type) ? 'complaint' : 'bounce'
    for (const recipient of recipientsOf(data)) {
      await suppress({ channel: 'email', recipient, reason, detail: data.bounce?.subType ?? type })
    }
  }

  // Stamp the delivery outcome on the original attempt when we know the id.
  const status = RESEND_DELIVERY_STATUS[type]
  if (providerMessageId && status) {
    await updateDelivery({ providerMessageId, deliveryStatus: status, error: type === 'email.bounced' ? type : null })
  }
  return { handled: true, type }
}

// ── Twilio ───────────────────────────────────────────────────────────────
//
// Twilio posts an x-www-form-urlencoded StatusCallback with MessageSid +
// MessageStatus ('delivered'|'failed'|'undelivered'|'sent'|...). We stamp the
// send_log row and, on 'undelivered'/'failed' caused by an opt-out (ErrorCode
// 21610 = recipient unsubscribed), suppress the number.
//
// Verification: X-Twilio-Signature is HMAC-SHA1 over the full URL + sorted POST
// params, keyed by the Twilio auth token. We verify when `twilio_api_key_secret`
// (used as the signing key) is configured AND a fully-qualified URL is known;
// otherwise accept (dev-stub). Computed from the parsed form body — no raw body
// needed (Twilio's algorithm is order-independent on the params).
const TWILIO_OPT_OUT_CODES = new Set(['21610'])
const TWILIO_DELIVERY_STATUS = new Set(['delivered', 'failed', 'undelivered', 'sent', 'queued', 'sending'])

export function computeTwilioSignature(authToken, url, params) {
  // Twilio: append each POST param, sorted by key, as key+value (no separators)
  // to the URL, then HMAC-SHA1 with the auth token, base64-encoded.
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const k of sortedKeys) data += k + params[k]
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

export async function verifyTwilioSignature({ signature, url, params }) {
  const client = await pool.connect()
  let authToken
  try {
    authToken = await configRepo.getValue(client, 'twilio_api_key_secret')
  } finally {
    client.release()
  }
  if (!authToken || !url) return true // dev-stub: nothing to verify against
  if (!signature) return false
  const expected = computeTwilioSignature(authToken, url, params)
  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function handleTwilioStatus(params) {
  const providerMessageId = params.MessageSid ?? params.SmsSid ?? null
  const status = params.MessageStatus ?? params.SmsStatus ?? null
  const errorCode = params.ErrorCode ?? null

  if (providerMessageId && status && TWILIO_DELIVERY_STATUS.has(status)) {
    await updateDelivery({
      providerMessageId,
      deliveryStatus: status,
      error: errorCode ? `Twilio ErrorCode ${errorCode}` : null,
    })
  }

  // Recipient unsubscribed (STOP) → suppress the number so we never text again.
  if (errorCode && TWILIO_OPT_OUT_CODES.has(String(errorCode)) && params.To) {
    await suppress({ channel: 'sms', recipient: params.To, reason: 'opt_out', detail: `Twilio ${errorCode}` })
  }
  return { handled: true, status }
}

// Shared best-effort send_log delivery stamp.
async function updateDelivery({ providerMessageId, deliveryStatus, error }) {
  let client
  try {
    client = await pool.connect()
    const n = await sendLogRepo.updateDeliveryStatus(client, { providerMessageId, deliveryStatus, error })
    if (n === 0) logger.debug({ providerMessageId, deliveryStatus }, 'delivery webhook: no matching send_log row')
  } catch (err) {
    logger.error({ err, providerMessageId, deliveryStatus }, 'failed to stamp delivery_status')
  } finally {
    client?.release()
  }
}
