// Every minute — flip telehealth rooms whose access window already closed to
// 'expired' and publish telehealth.room.expired per room. Mirrors
// telehealth.service.expireStaleRooms / repository.expireStaleRooms, but runs
// cross-tenant: the in-module version is per-tenant (called from the admin
// endpoint with a tenant ctx), whereas the scheduler has BYPASSRLS and no
// tenant context, so it sweeps every tenant in one atomic UPDATE. The chained
// LIMIT subquery is dropped — the scheduler purges the full backlog each tick.
// Note: this job intentionally does NOT write platform_telehealth.room_events;
// the scheduler role holds only SELECT/UPDATE on rooms, and the event below is
// the cross-module signal the telehealth subscriber reacts to.

export const meta = {
  name:        'telehealth-expire-stale',
  cron:        '* * * * *',
  description: 'Flip telehealth rooms past their access window to expired',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `UPDATE platform_telehealth.rooms
        SET status = 'expired', updated_at = now()
      WHERE status IN ('created', 'active')
        AND expires_at < now()
      RETURNING id, app_id, tenant_id, booking_id`,
  )
  for (const r of rows) {
    await publish({
      type: 'telehealth.room.expired',
      payload: {
        appId:     r.app_id,
        tenantId:  r.tenant_id,
        roomId:    r.id,
        bookingId: r.booking_id,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'stale telehealth rooms expired')
  return { rowsAffected: rows.length }
}
