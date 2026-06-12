// Every 15 minutes — surface leads whose snooze ("volver a contactar el …",
// leads.next_follow_up_at) has just come due, and publish lead.followup.due so
// notifications can ping the owner. Closes use-cases leads.md §9 (recordatorios
// de follow-up).
//
// Like the reminder/SLA jobs, the scheduler only holds SELECT on platform_leads
// (no idempotency column to stamp), so this uses the WINDOW pattern: emit only
// for leads whose next_follow_up_at crossed into the last tick window
// ( now() - WINDOW , now() ], so each follow-up is reported exactly once. A
// past-dated snooze set between ticks is caught on the next crossing; matches
// messaging-sla's accepted trade-off.
import { env } from '../lib/env.js'

export const meta = {
  name:        'lead-followup-due',
  cron:        '*/15 * * * *',
  description: 'Publish lead.followup.due when a lead snooze comes due',
}

const WINDOW_MINUTES = 15

// Estados "vivos": un follow-up sobre un lead ya cerrado (won/lost/closed) no
// tiene sentido — no se notifica.
const OPEN_STATUSES = "('new', 'contacted', 'qualified')"

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `SELECT l.id, l.app_id, l.assigned_to, l.status, l.next_follow_up_at
       FROM platform_leads.leads l
      WHERE l.status IN ${OPEN_STATUSES}
        AND l.next_follow_up_at IS NOT NULL
        AND l.next_follow_up_at <= now()
        AND l.next_follow_up_at >  now() - ($1 || ' minutes')::interval`,
    [String(WINDOW_MINUTES)],
  )
  for (const l of rows) {
    await publish({
      type: 'lead.followup.due',
      payload: {
        appId:         l.app_id,
        leadId:        l.id,
        assignedTo:    l.assigned_to,
        status:        l.status,
        nextFollowUpAt: l.next_follow_up_at,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'lead follow-ups due')
  return { rowsAffected: rows.length }
}
