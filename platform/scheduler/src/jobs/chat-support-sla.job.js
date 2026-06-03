// Every 15 minutes — flag support conversations that have gone too long with no
// agent reply. A conversation breaches when it's still open/pending, was opened
// more than SLA_HOURS ago, has no message from an 'agent' participant, and
// hasn't been flagged yet. sla_breached_at is stamped in the same UPDATE so a
// later run won't refire. The chat/notifications side reacts to the event.

export const meta = {
  name:        'chat-support-sla',
  cron:        '*/15 * * * *',
  description: 'Flag support conversations breaching the no-agent-reply SLA',
}

const SLA_HOURS = 4

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `WITH stale AS (
       SELECT c.id
         FROM platform_chat.conversations c
        WHERE c.type = 'support'
          AND c.support_status IN ('open', 'pending')
          AND c.sla_breached_at IS NULL
          AND c.created_at <= now() - ($1 || ' hours')::interval
          AND NOT EXISTS (
            SELECT 1
              FROM platform_chat.messages m
              JOIN platform_chat.conversation_participants p
                ON p.conversation_id = m.conversation_id AND p.user_id = m.sender_user_id
             WHERE m.conversation_id = c.id AND p.role = 'agent'
          )
     )
     UPDATE platform_chat.conversations c
        SET sla_breached_at = now()
       FROM stale
      WHERE c.id = stale.id
      RETURNING c.id, c.app_id, c.tenant_id, c.assigned_agent_user_id, c.priority, c.created_at`,
    [String(SLA_HOURS)],
  )
  for (const c of rows) {
    await publish({
      type: 'chat.support.sla_breached',
      payload: {
        appId: c.app_id, tenantId: c.tenant_id, conversationId: c.id,
        assignedAgentUserId: c.assigned_agent_user_id, priority: c.priority,
        openedAt: c.created_at, slaHours: SLA_HOURS,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'support SLA breaches flagged')
  return { rowsAffected: rows.length }
}
