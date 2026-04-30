// Every 5 minutes, find confirmed reservations approaching T-24h or T-2h
// and publish reservation.reminder.due. Same idempotency pattern as bookings.

export const meta = {
  name:        'reservation-reminders',
  cron:        '*/5 * * * *',
  description: 'Publish T-24h / T-2h reminders for confirmed reservations',
}

const WINDOWS = [
  { offsetMinutes: 24 * 60, slack: 30, column: 'reminder_24h_sent_at', label: 't_minus_24h' },
  { offsetMinutes: 2 * 60,  slack: 5,  column: 'reminder_2h_sent_at',  label: 't_minus_2h'  },
]

export async function run({ db, publish, logger }) {
  let total = 0
  for (const w of WINDOWS) {
    const { rows } = await db.query(
      `UPDATE platform_reservations.reservations
       SET ${w.column} = now()
       WHERE status = 'confirmed'
         AND ${w.column} IS NULL
         AND reserved_for BETWEEN
             now() + ($1 || ' minutes')::interval - ($2 || ' minutes')::interval
         AND now() + ($1 || ' minutes')::interval + ($2 || ' minutes')::interval
       RETURNING id, app_id, tenant_id, guest_user_id, guest_email, guest_phone, guest_name,
                 party_size, reserved_for, table_id`,
      [String(w.offsetMinutes), String(w.slack)],
    )
    for (const r of rows) {
      await publish({
        type: 'reservation.reminder.due',
        payload: {
          appId:         r.app_id,
          tenantId:      r.tenant_id,
          reservationId: r.id,
          guestUserId:   r.guest_user_id,
          guestEmail:    r.guest_email,
          guestPhone:    r.guest_phone,
          guestName:     r.guest_name,
          partySize:     r.party_size,
          reservedFor:   r.reserved_for,
          tableId:       r.table_id,
          window:        w.label,
        },
      })
    }
    total += rows.length
    if (rows.length) logger.info({ window: w.label, count: rows.length }, 'reservation reminders published')
  }
  return { rowsAffected: total }
}
