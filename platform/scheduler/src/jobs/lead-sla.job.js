// Every 30 minutes — two health signals over the open pipeline, both via the
// SELECT-only WINDOW pattern (the scheduler holds no idempotency column on
// platform_leads). Closes use-cases leads.md §6 (SLA por etapa) and §9 (leads
// estancados).
//
//   1. lead.sla.uncontacted — a lead still in 'new' that has sat untouched
//      longer than LEADS_NEW_SLA_HOURS. Emitted once, when created_at crosses
//      the SLA boundary inside the last tick window.
//   2. lead.stale — an OPEN lead (new/contacted/qualified) with no touch for
//      LEADS_STALE_DAYS. "Touch" = greatest(updated_at, last activity, created_at)
//      so a logged call/note keeps a lead fresh even though the row's updated_at
//      isn't bumped by activity inserts. Emitted once per quiet stretch; further
//      activity resets the clock and it can fire again later.
import { env } from '../lib/env.js'

export const meta = {
  name:        'lead-sla',
  cron:        '*/30 * * * *',
  description: 'Publish lead.sla.uncontacted + lead.stale for the open pipeline',
}

const WINDOW_MINUTES = 30
const OPEN_STATUSES = "('new', 'contacted', 'qualified')"

export async function run({ db, publish, logger }) {
  // ── (1) Leads 'new' que cruzan el SLA de primer contacto ────────────────
  const { rows: uncontacted } = await db.query(
    `SELECT l.id, l.app_id, l.assigned_to, l.created_at
       FROM platform_leads.leads l
      WHERE l.status = 'new'
        AND l.created_at <= now() - ($1 || ' hours')::interval
        AND l.created_at >  now() - ($1 || ' hours')::interval - ($2 || ' minutes')::interval`,
    [String(env.LEADS_NEW_SLA_HOURS), String(WINDOW_MINUTES)],
  )
  for (const l of uncontacted) {
    await publish({
      type: 'lead.sla.uncontacted',
      payload: {
        appId:      l.app_id,
        leadId:     l.id,
        assignedTo: l.assigned_to,
        createdAt:  l.created_at,
        slaHours:   env.LEADS_NEW_SLA_HOURS,
      },
    })
  }

  // ── (2) Leads abiertos sin actividad > STALE_DAYS ───────────────────────
  const { rows: stale } = await db.query(
    `WITH touched AS (
       SELECT l.id, l.app_id, l.assigned_to, l.status,
              greatest(
                l.updated_at,
                coalesce(
                  (SELECT max(a.created_at) FROM platform_leads.lead_activities a WHERE a.lead_id = l.id),
                  l.created_at
                )
              ) AS touched_at
         FROM platform_leads.leads l
        WHERE l.status IN ${OPEN_STATUSES}
     )
     SELECT id, app_id, assigned_to, status, touched_at
       FROM touched
      WHERE touched_at <= now() - ($1 || ' days')::interval
        AND touched_at >  now() - ($1 || ' days')::interval - ($2 || ' minutes')::interval`,
    [String(env.LEADS_STALE_DAYS), String(WINDOW_MINUTES)],
  )
  for (const l of stale) {
    await publish({
      type: 'lead.stale',
      payload: {
        appId:      l.app_id,
        leadId:     l.id,
        assignedTo: l.assigned_to,
        status:     l.status,
        lastTouchAt: l.touched_at,
        staleDays:  env.LEADS_STALE_DAYS,
      },
    })
  }

  const total = uncontacted.length + stale.length
  if (total) logger.info({ uncontacted: uncontacted.length, stale: stale.length }, 'lead SLA signals flagged')
  return { rowsAffected: total }
}
