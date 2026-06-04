// Every 15 minutes — flag buyer↔vendor threads where the vendor never replied
// within the SLA, and publish messaging.vendor.sla_breached. The messaging
// module added threads.first_reply_at (NULL = vendor hasn't replied yet) for
// exactly this scan, but did NOT add an idempotency column we may write to —
// the scheduler only holds SELECT on platform_messaging. So instead of the
// UPDATE-RETURNING sentinel pattern, this job uses the WINDOW pattern of the
// reminder jobs: it only emits for threads that crossed the SLA boundary within
// the last tick, so a thread is reported exactly once.
//
// A thread crosses the boundary when now() reaches created_at + SLA. For a
// */15 cron tick we therefore select threads whose (created_at + SLA) landed in
// the (previous tick, now] window, i.e. created_at in
//   ( now() - SLA - WINDOW , now() - SLA ].
import { env } from '../lib/env.js'

export const meta = {
  name:        'messaging-sla',
  cron:        '*/15 * * * *',
  description: 'Flag buyer↔vendor threads breaching the vendor first-reply SLA',
}

const WINDOW_MINUTES = 15

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `SELECT t.id, t.app_id, t.tenant_id, t.buyer_user_id, t.vendor_user_id, t.order_id, t.created_at
       FROM platform_messaging.threads t
      WHERE t.status = 'open'
        AND t.first_reply_at IS NULL
        AND t.created_at <= now() - ($1 || ' hours')::interval
        AND t.created_at >  now() - ($1 || ' hours')::interval - ($2 || ' minutes')::interval`,
    [String(env.MESSAGING_SLA_HOURS), String(WINDOW_MINUTES)],
  )
  for (const t of rows) {
    await publish({
      type: 'messaging.vendor.sla_breached',
      payload: {
        appId:        t.app_id,
        tenantId:     t.tenant_id,
        threadId:     t.id,
        buyerUserId:  t.buyer_user_id,
        vendorUserId: t.vendor_user_id,
        orderId:      t.order_id,
        openedAt:     t.created_at,
        slaHours:     env.MESSAGING_SLA_HOURS,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'vendor SLA breaches flagged')
  return { rowsAffected: rows.length }
}
