// Provider delivery webhooks — PUBLIC (no JWT; the providers sign their own
// requests). Mounted at /v1/notifications/webhooks/{resend,twilio}.
//
//   POST /resend  — Resend events (delivered / bounced / complained / …).
//                   Guarded by an optional shared secret (x-webhook-secret).
//   POST /twilio  — Twilio SMS StatusCallback (form-encoded).
//                   Guarded by an optional X-Twilio-Signature HMAC.
//
// Both always reply 200 (even on a no-op) so the provider stops retrying; the
// processing is best-effort and idempotent (see webhook.service.js).
import { z } from 'zod'
import {
  verifyResendWebhook, handleResendEvent,
  verifyTwilioSignature, handleTwilioStatus,
} from '../services/webhook.service.js'
import { logger } from '../lib/logger.js'

const tags = ['notifications · webhooks']

// Resend event envelope. Loose by design — we only read a few fields and must
// tolerate event types/shapes we don't model.
const resendBody = z.object({
  type: z.string().min(1),
  data: z.record(z.any()).optional(),
}).passthrough()

export async function webhooksRoutes(fastify) {
  fastify.post('/resend', {
    config: { public: true, rawBody: true },
    schema: {
      tags,
      summary: 'Resend delivery webhook (bounce/complaint → suppression, delivery_status stamp)',
      body: resendBody,
    },
  }, async (req, reply) => {
    const ok = await verifyResendWebhook({
      rawBody: req.rawBody ?? JSON.stringify(req.body ?? {}),
      headers: req.headers,
    })
    if (!ok) return reply.code(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'bad webhook secret' } })
    const event = resendBody.parse(req.body ?? {})
    try {
      const r = await handleResendEvent(event)
      return { received: true, ...r }
    } catch (err) {
      logger.error({ err, type: event.type }, 'resend webhook processing failed')
      // Still 200 — a processing error shouldn't trigger endless provider retries.
      return { received: true }
    }
  })

  fastify.post('/twilio', {
    config: { public: true },
    schema: {
      tags,
      summary: 'Twilio SMS StatusCallback (delivery_status stamp, opt-out → suppression)',
      // Twilio posts x-www-form-urlencoded; accept any string map.
      body: z.record(z.string()).optional(),
    },
  }, async (req, reply) => {
    const params = req.body ?? {}
    // Reconstruct the absolute URL Twilio signed over (scheme + host + path).
    const proto = req.headers['x-forwarded-proto'] ?? 'https'
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? ''
    const url = `${proto}://${host}${req.url}`
    const ok = await verifyTwilioSignature({
      signature: req.headers['x-twilio-signature'], url, params,
    })
    if (!ok) return reply.code(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'bad Twilio signature' } })
    try {
      const r = await handleTwilioStatus(params)
      return { received: true, ...r }
    } catch (err) {
      logger.error({ err }, 'twilio webhook processing failed')
      return { received: true }
    }
  })
}
