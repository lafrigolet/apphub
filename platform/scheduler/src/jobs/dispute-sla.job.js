// Every 30 minutes — find disputes in 'open' state for >48h with no vendor
// reply and publish dispute.sla_breached. The disputes module's subscriber
// can then auto-move to 'investigating' or escalate to staff.

export const meta = {
  name:        'dispute-sla',
  cron:        '*/30 * * * *',
  description: 'Auto-flag disputes that breach the 48h vendor-response SLA',
}

const SLA_HOURS = 48

export async function run({ db, publish, logger }) {
  // Use a CTE to find disputes that:
  //   - are still 'open',
  //   - were created > SLA_HOURS ago,
  //   - have no message from sender_role='vendor',
  //   - haven't been flagged yet (sla_breached_at IS NULL).
  // Stamp sla_breached_at in the same UPDATE so a second run doesn't refire.
  const { rows } = await db.query(
    `WITH stale AS (
       SELECT d.id
       FROM platform_disputes.disputes d
       WHERE d.status = 'open'
         AND d.sla_breached_at IS NULL
         AND d.created_at <= now() - ($1 || ' hours')::interval
         AND NOT EXISTS (
           SELECT 1 FROM platform_disputes.dispute_messages m
           WHERE m.dispute_id = d.id AND m.sender_role = 'vendor'
         )
     )
     UPDATE platform_disputes.disputes d
     SET sla_breached_at = now()
     FROM stale
     WHERE d.id = stale.id
     RETURNING d.id, d.app_id, d.tenant_id, d.order_id, d.buyer_user_id, d.created_at`,
    [String(SLA_HOURS)],
  )
  for (const d of rows) {
    await publish({
      type: 'dispute.sla_breached',
      payload: {
        appId:        d.app_id,
        tenantId:     d.tenant_id,
        disputeId:    d.id,
        orderId:      d.order_id,
        buyerUserId:  d.buyer_user_id,
        openedAt:     d.created_at,
        slaHours:     SLA_HOURS,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'SLA-breached disputes flagged')
  return { rowsAffected: rows.length }
}
