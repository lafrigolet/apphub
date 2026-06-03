// Every minute — find chat messages whose scheduled_for has arrived and signal
// the chat module to deliver them. We stamp dispatched_at in the same UPDATE so
// the next tick doesn't re-publish; the chat consumer performs the real
// atomic flip-to-sent + fan-out (single write path stays in the chat module).

export const meta = {
  name:        'chat-scheduled-send',
  cron:        '* * * * *',
  description: 'Publish chat.scheduled.due for chat messages whose send time arrived',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `UPDATE platform_chat.messages
        SET dispatched_at = now()
      WHERE status = 'scheduled'
        AND dispatched_at IS NULL
        AND scheduled_for <= now()
      RETURNING id, app_id, tenant_id, conversation_id`,
  )
  for (const m of rows) {
    await publish({
      type: 'chat.scheduled.due',
      payload: { appId: m.app_id, tenantId: m.tenant_id, subTenantId: null, messageId: m.id, conversationId: m.conversation_id },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'scheduled chat messages dispatched')
  return { rowsAffected: rows.length }
}
