// Every 5 minutes, find confirmed bookings approaching T-24h or T-2h and
// publish booking.reminder.due. Idempotency is enforced by the
// reminder_24h_sent_at / reminder_2h_sent_at columns: we only publish for rows
// where the column is NULL, then stamp it inside the same UPDATE.

export const meta = {
  name:        'booking-reminders',
  cron:        '*/5 * * * *',
  description: 'Publish T-24h / T-2h reminders for confirmed bookings',
}

const WINDOWS = [
  { offsetMinutes: 24 * 60, slack: 30, column: 'reminder_24h_sent_at', label: 't_minus_24h' },
  { offsetMinutes: 2 * 60,  slack: 5,  column: 'reminder_2h_sent_at',  label: 't_minus_2h'  },
]

export async function run({ db, publish, logger }) {
  let total = 0
  for (const w of WINDOWS) {
    const { rows } = await db.query(
      `UPDATE platform_bookings.bookings
       SET ${w.column} = now()
       WHERE status IN ('confirmed','reminded')
         AND ${w.column} IS NULL
         AND starts_at BETWEEN
             now() + ($1 || ' minutes')::interval - ($2 || ' minutes')::interval
         AND now() + ($1 || ' minutes')::interval + ($2 || ' minutes')::interval
       RETURNING id, app_id, tenant_id, service_id, client_user_id, client_email, client_phone, client_name, starts_at, ends_at`,
      [String(w.offsetMinutes), String(w.slack)],
    )
    for (const b of rows) {
      await publish({
        type: 'booking.reminder.due',
        payload: {
          appId:        b.app_id,
          tenantId:     b.tenant_id,
          bookingId:    b.id,
          serviceId:    b.service_id,
          clientUserId: b.client_user_id,
          clientEmail:  b.client_email,
          clientPhone:  b.client_phone,
          clientName:   b.client_name,
          startsAt:     b.starts_at,
          endsAt:       b.ends_at,
          window:       w.label,
        },
      })
    }
    total += rows.length
    if (rows.length) logger.info({ window: w.label, count: rows.length }, 'reminders published')
  }
  return { rowsAffected: total }
}
