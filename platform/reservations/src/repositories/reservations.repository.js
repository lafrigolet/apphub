const SCHEMA = 'platform_reservations'

export async function insertReservation(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.reservations
       (app_id, tenant_id, sub_tenant_id, guest_user_id, guest_name, guest_email, guest_phone,
        party_size, reserved_for, duration_minutes, table_id, status, notes, source, locale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,90),$11,COALESCE($12,'requested'),$13,COALESCE($14,'portal'),$15)
     RETURNING *`,
    [
      r.appId, r.tenantId, r.subTenantId ?? null, r.guestUserId ?? null,
      r.guestName, r.guestEmail ?? null, r.guestPhone ?? null,
      r.partySize, r.reservedFor, r.durationMinutes ?? 90,
      r.tableId ?? null, r.status ?? 'requested', r.notes ?? null, r.source ?? 'portal',
      r.locale ?? null,
    ],
  )
  return rows[0]
}

export async function listReservations(client, appId, tenantId, { from, to, status, limit = 100 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (from)   { filters.push(`reserved_for >= $${i++}`); params.push(from) }
  if (to)     { filters.push(`reserved_for <  $${i++}`); params.push(to) }
  if (status) { filters.push(`status = $${i++}`);        params.push(status) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.reservations WHERE ${filters.join(' AND ')}
     ORDER BY reserved_for ASC LIMIT $${i++}`,
    params,
  )
  return rows
}

export async function findReservationById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.reservations WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function updateReservationStatus(client, appId, tenantId, id, status, tableId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.reservations SET status=$4, table_id = COALESCE($5, table_id), updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status, tableId ?? null],
  )
  return rows[0] ?? null
}

export async function insertWaitlistEntry(client, w) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.waitlist (app_id, tenant_id, guest_name, guest_phone, party_size, status, estimated_wait_minutes, notes)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'waiting'),$7,$8) RETURNING *`,
    [w.appId, w.tenantId, w.guestName, w.guestPhone ?? null, w.partySize, w.status ?? 'waiting',
     w.estimatedWaitMinutes ?? null, w.notes ?? null],
  )
  return rows[0]
}

export async function listWaitlist(client, appId, tenantId, { status } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (status) { filters.push(`status = $${i++}`); params.push(status) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.waitlist WHERE ${filters.join(' AND ')}
     ORDER BY created_at ASC`,
    params,
  )
  return rows
}

export async function updateWaitlistStatus(client, appId, tenantId, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.waitlist SET status=$4, updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

export async function insertServiceHours(client, h) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.service_hours (app_id, tenant_id, day_of_week, open_minute, close_minute, service_label, is_closed)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,FALSE)) RETURNING *`,
    [h.appId, h.tenantId, h.dayOfWeek, h.openMinute, h.closeMinute, h.serviceLabel ?? null, h.isClosed ?? false],
  )
  return rows[0]
}

export async function listServiceHours(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.service_hours WHERE app_id=$1 AND tenant_id=$2
     ORDER BY day_of_week, open_minute`,
    [appId, tenantId],
  )
  return rows
}
