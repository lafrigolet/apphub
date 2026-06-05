// Leads' subscriber on the platform bus. One event today:
// `lead.email.received` — published by platform/notifications when an inbound
// email matched a routing rule pointing at leads (e.g. exact address
// leads@reply.hulkstein.com). The sender becomes a lead; the cleaned reply
// text is the message. Closes the "captura desde email entrante" gap
// (use-cases leads.md §1). Mirrors chat's consumer shape (redis.duplicate()).
//
// Known V1 limits (same as the form path): no dedup — the same sender mailing
// twice creates two leads; notifications' per-sender rate limit (default 30/h)
// is the abuse bound.
import { create } from './leads.service.js'

export function startEventConsumer({ redis, logger }) {
  if (!redis || typeof redis.duplicate !== 'function') return null
  const sub = redis.duplicate()
  sub.subscribe('platform.events', (err) => {
    if (err) logger?.error?.({ err }, 'leads consumer failed to subscribe')
    else logger?.info?.('platform-leads subscribed to platform.events')
  })
  sub.on('message', async (_channel, raw) => {
    let event
    try { event = JSON.parse(raw) } catch { return }
    try {
      if (event.type === 'lead.email.received') {
        const p = event.payload ?? {}
        if (!p.from) return
        await create({
          contactName: p.fromName ?? p.from.split('@')[0],
          email:       p.from,
          message:     [p.subject, p.text || p.rawText].filter(Boolean).join('\n\n').slice(0, 10_000) || null,
          source:      'email-inbound',
          appId:       p.appId ?? null,
          customFields: { inboundEmailId: p.inboundEmailId ?? null },
        })
      }
    } catch (err) {
      logger?.warn?.({ err, type: event.type }, 'leads consumer handler failed')
    }
  })
  return sub
}
