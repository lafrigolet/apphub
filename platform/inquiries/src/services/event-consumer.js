// Inquiries' subscriber on the platform bus. One event today:
// `inquiry.reply.received` — published by platform/notifications when an
// inbound email matched the reply token minted for an inquiry confirmation
// (Reply-To: reply+<token>@…). The reply is appended to the inquiry timeline
// as an 'email_reply' activity; the admin-inbox alert email is notifications'
// concern, not ours. Mirrors chat's consumer shape (redis.duplicate()).
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/inquiries.repository.js'

export async function addEmailReply({ appId, tenantId, inquiryId, from, fromName, text, rawText, attachments, inboundEmailId }) {
  return withTenantTransaction(appId, tenantId, null, async (client) => {
    const inquiry = await repo.findById(client, inquiryId)
    if (!inquiry) return null
    return repo.insertActivity(client, inquiryId, {
      appId,
      tenantId,
      authorEmail: from ?? null,
      type: 'email_reply',
      body: (text || rawText || '').slice(0, 20_000),
      metadata: {
        from: from ?? null,
        fromName: fromName ?? null,
        inboundEmailId: inboundEmailId ?? null,
        attachments: (attachments ?? []).map((a) => ({
          filename: a.filename, contentType: a.contentType,
          sizeBytes: a.sizeBytes, bucket: a.bucket, objectKey: a.objectKey,
        })),
      },
    })
  })
}

export function startEventConsumer({ redis, logger }) {
  if (!redis || typeof redis.duplicate !== 'function') return null
  const sub = redis.duplicate()
  sub.subscribe('platform.events', (err) => {
    if (err) logger?.error?.({ err }, 'inquiries consumer failed to subscribe')
    else logger?.info?.('platform-inquiries subscribed to platform.events')
  })
  sub.on('message', async (_channel, raw) => {
    let event
    try { event = JSON.parse(raw) } catch { return }
    try {
      if (event.type === 'inquiry.reply.received') {
        const p = event.payload ?? {}
        const inquiryId = p.context?.inquiryId
        if (p.appId && p.tenantId && inquiryId) {
          await addEmailReply({
            appId: p.appId, tenantId: p.tenantId, inquiryId,
            from: p.from, fromName: p.fromName,
            text: p.text, rawText: p.rawText,
            attachments: p.attachments,
            inboundEmailId: p.inboundEmailId,
          })
        }
      }
    } catch (err) {
      logger?.warn?.({ err, type: event.type }, 'inquiries consumer handler failed')
    }
  })
  return sub
}
