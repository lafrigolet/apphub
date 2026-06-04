const SCHEMA = 'platform_reservations'

export async function insertReservation(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.reservations
       (app_id, tenant_id, sub_tenant_id, guest_user_id, guest_name, guest_email, guest_phone,
        party_size, reserved_for, duration_minutes, table_id, status, notes, source, locale,
        special_requests)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,90),$11,COALESCE($12,'requested'),$13,COALESCE($14,'portal'),$15,$16)
     RETURNING *`,
    [
      r.appId, r.tenantId, r.subTenantId ?? null, r.guestUserId ?? null,
      r.guestName, r.guestEmail ?? null, r.guestPhone ?? null,
      r.partySize, r.reservedFor, r.durationMinutes ?? 90,
      r.tableId ?? null, r.status ?? 'requested', r.notes ?? null, r.source ?? 'portal',
      r.locale ?? null, r.specialRequests ? JSON.stringify(r.specialRequests) : null,
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

export async function updateReservationStatus(client, appId, tenantId, id, status, tableId, meta = {}) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.reservations
        SET status=$4,
            table_id = COALESCE($5, table_id),
            cancellation_reason = CASE WHEN $4 = 'cancelled' THEN $6 ELSE cancellation_reason END,
            cancelled_by        = CASE WHEN $4 = 'cancelled' THEN $7 ELSE cancelled_by END,
            updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status, tableId ?? null, meta.cancellationReason ?? null, meta.cancelledBy ?? null],
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
    `INSERT INTO ${SCHEMA}.service_hours (app_id, tenant_id, day_of_week, open_minute, close_minute, service_label, is_closed, max_covers)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,FALSE),$8) RETURNING *`,
    [h.appId, h.tenantId, h.dayOfWeek, h.openMinute, h.closeMinute, h.serviceLabel ?? null, h.isClosed ?? false, h.maxCovers ?? null],
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

// Open service windows for a given ISO weekday (0=Sun … 6=Sat). Excludes
// is_closed windows. Used by availability checks and the public endpoint.
export async function listOpenServiceHoursForDay(client, appId, tenantId, dayOfWeek) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.service_hours
      WHERE app_id=$1 AND tenant_id=$2 AND day_of_week=$3 AND is_closed = FALSE
      ORDER BY open_minute`,
    [appId, tenantId, dayOfWeek],
  )
  return rows
}

// Is the given instant covered by a blackout (festives, private events, …)?
export async function findBlackoutCovering(client, appId, tenantId, at) {
  const { rows } = await client.query(
    `SELECT id, reason, starts_at, ends_at FROM ${SCHEMA}.blackouts
      WHERE app_id=$1 AND tenant_id=$2 AND starts_at <= $3 AND ends_at > $3
      LIMIT 1`,
    [appId, tenantId, at],
  )
  return rows[0] ?? null
}

// Sum of covers (party_size) for active reservations whose seating window
// [reserved_for, reserved_for + duration) overlaps [from, to). Active =
// requested | confirmed | seated (cancelled/no_show/completed free capacity).
// An optional reservation id is excluded (so re-checks don't count themselves).
export async function sumActiveCoversInWindow(client, appId, tenantId, from, to, excludeId = null) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(party_size), 0)::int AS covers
       FROM ${SCHEMA}.reservations
      WHERE app_id=$1 AND tenant_id=$2
        AND status IN ('requested','confirmed','seated')
        AND ($5::uuid IS NULL OR id <> $5)
        AND reserved_for < $4
        AND (reserved_for + (duration_minutes * interval '1 minute')) > $3`,
    [appId, tenantId, from, to, excludeId],
  )
  return rows[0].covers
}

// Count past no-shows for a guest, keyed by user id when authenticated, else
// by email. Returns 0 when neither identifier is supplied.
export async function countNoShowsByGuest(client, appId, tenantId, { guestUserId = null, guestEmail = null } = {}) {
  if (!guestUserId && !guestEmail) return 0
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM ${SCHEMA}.reservations
      WHERE app_id=$1 AND tenant_id=$2 AND status='no_show'
        AND ( ($3::uuid IS NOT NULL AND guest_user_id = $3)
           OR ($4::text IS NOT NULL AND guest_email = $4) )`,
    [appId, tenantId, guestUserId, guestEmail],
  )
  return rows[0].n
}

// First waiting waitlist entry (FIFO) that fits within `capacity` covers, used
// to auto-notify when a table frees up. Null when the queue is empty or no
// waiting entry fits.
export async function findNextWaitingForCapacity(client, appId, tenantId, capacity) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.waitlist
      WHERE app_id=$1 AND tenant_id=$2 AND status='waiting' AND party_size <= $3
      ORDER BY created_at ASC
      LIMIT 1`,
    [appId, tenantId, capacity],
  )
  return rows[0] ?? null
}
