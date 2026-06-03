import * as messages from './messages.service.js'

// Chat's own subscriber on the platform bus. Today it handles a single event:
// `chat.scheduled.due`, published by platform-scheduler when a scheduled
// message's time arrives — we then run the real delivery (flip to 'sent',
// bump the conversation, fan out over WS + notify). Keeping delivery here (not
// in the scheduler) preserves the single auditable write path in the chat
// module. Returns the subscriber so register() can close it on shutdown.
export function startEventConsumer({ redis, logger }) {
  if (!redis || typeof redis.duplicate !== 'function') return null
  const sub = redis.duplicate()
  sub.subscribe('platform.events', (err) => {
    if (err) logger?.error?.({ err }, 'chat consumer failed to subscribe')
    else logger?.info?.('platform-chat subscribed to platform.events')
  })
  sub.on('message', async (_channel, raw) => {
    let event
    try { event = JSON.parse(raw) } catch { return }
    try {
      if (event.type === 'chat.scheduled.due') {
        const { appId, tenantId, subTenantId, messageId } = event.payload ?? {}
        if (appId && tenantId && messageId) {
          await messages.deliverScheduledFor({ appId, tenantId, subTenantId, messageId })
        }
      }
    } catch (err) {
      logger?.warn?.({ err, type: event.type }, 'chat consumer handler failed')
    }
  })
  return sub
}
