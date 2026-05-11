import { logger } from '../lib/logger.js'
import { subscribe, publish } from '../lib/redis.js'
import { pool, withTenantTransaction } from '../lib/db.js'

// Cuando platform/services emite `service.session.cancelled`, las
// bookings con ese session_id quedan colgantes. Este subscriber las
// cancela en masa (status = 'cancelled', actor = system).
//
// No usamos el FSM `cancelBooking` del service porque:
//   1) Bypassa la cancellation_policy — la cancela el admin que canceló
//      la convocatoria, no el cliente.
//   2) Las bookings que estuvieran ya en 'cancelled' / 'completed' / etc.
//      no se tocan (idempotencia).
async function cancelBookingsForSession({ appId, tenantId, sessionId }) {
  if (!appId || !tenantId || !sessionId) return 0
  return withTenantTransaction(pool, appId, tenantId, null, async (c) => {
    const { rows } = await c.query(
      `UPDATE platform_bookings.bookings
       SET status = 'cancelled', updated_at = now()
       WHERE app_id = $1 AND tenant_id = $2 AND session_id = $3
         AND status NOT IN ('cancelled', 'no_show', 'rescheduled', 'completed')
       RETURNING id, client_user_id, starts_at`,
      [appId, tenantId, sessionId],
    )
    // Audit row per booking + event para que el handler downstream
    // (notifications) pueda avisar a cada inscrito.
    for (const r of rows) {
      await c.query(
        `INSERT INTO platform_bookings.booking_events
           (app_id, tenant_id, booking_id, from_status, to_status, actor_user_id, reason)
         VALUES ($1, $2, $3, NULL, 'cancelled', NULL, $4)`,
        [appId, tenantId, r.id, 'session cancelled by admin'],
      )
      await publish({
        type: 'booking.cancelled',
        payload: {
          appId, tenantId, bookingId: r.id,
          sessionId, clientUserId: r.client_user_id,
          startsAt: r.starts_at,
          reason: 'session_cancelled',
        },
      })
    }
    return rows.length
  })
}

export function startSessionCancelledSubscriber() {
  return subscribe(async (_chan, raw) => {
    let evt
    try { evt = JSON.parse(raw) } catch { return }
    if (evt.type !== 'service.session.cancelled') return
    try {
      const n = await cancelBookingsForSession(evt.payload ?? {})
      if (n > 0) logger.info({ ...evt.payload, cancelled: n }, 'bookings cancelled by session cancellation')
    } catch (err) {
      logger.error({ err, payload: evt.payload }, 'session.cancelled handler failed')
    }
  })
}
