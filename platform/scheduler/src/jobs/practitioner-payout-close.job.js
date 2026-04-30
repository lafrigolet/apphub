// Daily at 02:00 — find practitioner payout schedules whose period_end is
// today (or earlier and never closed) and publish payout.period_due. The
// practitioner-payouts module's subscriber will call closePeriod() and
// advance the schedule's next anchor.

export const meta = {
  name:        'practitioner-payout-close',
  cron:        '0 2 * * *',
  description: 'Trigger period close for practitioner payout schedules',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `SELECT id, app_id, tenant_id, practitioner_id, period, anchor_day,
            COALESCE(last_closed_at, '1970-01-01'::timestamptz) AS last_closed_at
     FROM platform_practitioner_payouts.payout_schedules
     WHERE next_run_at <= now()`,
  )
  let triggered = 0
  for (const s of rows) {
    // Compute period boundaries based on the schedule's period type.
    const now = new Date()
    let periodStart, periodEnd
    if (s.period === 'weekly') {
      periodEnd   = startOfWeek(now)
      periodStart = subtractDays(periodEnd, 7)
    } else if (s.period === 'biweekly') {
      periodEnd   = startOfWeek(now)
      periodStart = subtractDays(periodEnd, 14)
    } else {
      // monthly
      periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    }

    await publish({
      type: 'payout.period_due',
      payload: {
        appId:          s.app_id,
        tenantId:       s.tenant_id,
        scheduleId:     s.id,
        practitionerId: s.practitioner_id,
        period:         s.period,
        periodStart:    periodStart.toISOString(),
        periodEnd:      periodEnd.toISOString(),
      },
    })

    // Advance the next_run_at so we don't re-trigger this schedule until
    // the following period. The actual close is async — if it fails, the
    // schedule still advances; staff can re-trigger via the admin endpoint.
    await db.query(
      `UPDATE platform_practitioner_payouts.payout_schedules
       SET last_closed_at = now(),
           next_run_at = CASE
             WHEN period = 'weekly'   THEN now() + interval '7 days'
             WHEN period = 'biweekly' THEN now() + interval '14 days'
             WHEN period = 'monthly'  THEN now() + interval '1 month'
           END
       WHERE id = $1`,
      [s.id],
    )
    triggered++
  }
  if (triggered) logger.info({ count: triggered }, 'payout periods triggered')
  return { rowsAffected: triggered }
}

function startOfWeek(d) {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  x.setUTCDate(x.getUTCDate() - x.getUTCDay())
  return x
}
function subtractDays(d, n) {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() - n)
  return x
}
