import { logger } from '../lib/logger.js'
import { subscribe, publish } from '../lib/redis.js'
import { pool, withTenantTransaction } from '../lib/db.js'

// Cuando platform/commerce confirma el pago de una reserva
// (commerce.purchase.paid, kind=booking), marcamos la reserva como confirmada
// (pagada). refId = bookingId. Idempotente: sólo confirma si está 'requested'.
async function confirmPaidBooking({ appId, tenantId, refId }) {
  if (!appId || !tenantId || !refId) return null
  return withTenantTransaction(pool, appId, tenantId, null, async (c) => {
    const { rows } = await c.query(
      `UPDATE platform_bookings.bookings
          SET status = 'confirmed', updated_at = now()
        WHERE app_id = $1 AND tenant_id = $2 AND id = $3 AND status = 'requested'
        RETURNING id, client_user_id, starts_at`,
      [appId, tenantId, refId],
    )
    const b = rows[0]
    if (!b) return null
    await c.query(
      `INSERT INTO platform_bookings.booking_events
         (app_id, tenant_id, booking_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1, $2, $3, 'requested', 'confirmed', NULL, 'paid via commerce')`,
      [appId, tenantId, b.id],
    )
    await publish({
      type: 'booking.confirmed',
      payload: { appId, tenantId, bookingId: b.id, clientUserId: b.client_user_id, startsAt: b.starts_at },
    })
    return b.id
  })
}

export function startCommercePaidSubscriber() {
  return subscribe(async (_chan, raw) => {
    let evt
    try { evt = JSON.parse(raw) } catch { return }
    if (evt.type !== 'commerce.purchase.paid') return
    const p = evt.payload ?? {}
    if (p.kind !== 'booking') return
    try {
      const id = await confirmPaidBooking(p)
      if (id) logger.info({ bookingId: id, checkoutId: p.checkoutId }, 'booking confirmada por pago (commerce)')
    } catch (err) {
      logger.error({ err, payload: p }, 'commerce.purchase.paid handler failed')
    }
  })
}
