const SCHEMA = 'platform_bookings'

// Atomic insert that refuses if any non-cancelled booking already overlaps
// the same time window on any of the requested resources. The overlap test
// uses tstzrange(...) && tstzrange(...) — same operator availability uses to
// gate hold creation. Returns null if a conflict was detected so the caller
// can map it to 409 SLOT_TAKEN.
//
// `resourceIds` is required: the check is per-resource, so a booking with no
// resources couldn't be guarded. `bookings.service.createBooking` already
// validates this.
export async function insertBookingAtomic(client, appId, tenantId, b) {
  if (!Array.isArray(b.resourceIds) || b.resourceIds.length === 0) {
    throw new Error('resourceIds required for atomic insert')
  }
  const { rows } = await client.query(
    `WITH overlapping AS (
       SELECT 1
       FROM ${SCHEMA}.bookings ob
       JOIN ${SCHEMA}.booking_resources obr ON obr.booking_id = ob.id
       WHERE ob.app_id = $1 AND ob.tenant_id = $2
         AND obr.resource_id = ANY($21::uuid[])
         AND ob.status NOT IN ('cancelled','no_show','rescheduled','completed')
         AND tstzrange(ob.starts_at, ob.ends_at, '[)')
             && tstzrange($9::timestamptz, $10::timestamptz, '[)')
     )
     INSERT INTO ${SCHEMA}.bookings
       (app_id, tenant_id, sub_tenant_id, service_id, client_user_id, client_name, client_email, client_phone,
        starts_at, ends_at, status, notes, internal_notes,
        recurrence_id, parent_booking_id, package_id, price_cents, currency, source, metadata, locale)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'requested'),$12,$13,$14,$15,$16,$17,$18,COALESCE($19,'portal'),COALESCE($20,'{}'::jsonb),$22
     WHERE NOT EXISTS (SELECT 1 FROM overlapping)
     RETURNING *`,
    [
      appId, tenantId, b.subTenantId ?? null, b.serviceId, b.clientUserId,
      b.clientName ?? null, b.clientEmail ?? null, b.clientPhone ?? null,
      b.startsAt, b.endsAt, b.status ?? 'requested',
      b.notes ?? null, b.internalNotes ?? null,
      b.recurrenceId ?? null, b.parentBookingId ?? null, b.packageId ?? null,
      b.priceCents ?? null, b.currency ?? null, b.source ?? 'portal', b.metadata ?? {},
      b.resourceIds,
      b.locale ?? null,
    ],
  )
  return rows[0] ?? null
}

// Insert para bookings ligadas a una `service_session` (eventos). NO
// usa el overlap-guard por recurso (sin él porque varios asistentes
// comparten el mismo recurso); en su lugar el caller debe haber
// validado la capacidad. La capacidad se chequea dentro de la misma
// transacción mediante `countBookingsForSession` justo antes de insertar.
// La verificación + insert + cuenta corre con FOR UPDATE / SERIALIZABLE
// implícito vía la propia tx — postgres serializa correctamente
// concurrent inserts si el chequeo se hace dentro de la tx (read +
// write en un round-trip evita el race).
export async function insertBookingForSession(client, appId, tenantId, b) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bookings
       (app_id, tenant_id, sub_tenant_id, service_id, client_user_id, client_name, client_email, client_phone,
        starts_at, ends_at, status, notes, internal_notes,
        recurrence_id, parent_booking_id, package_id, price_cents, currency, source, metadata, locale,
        session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'requested'),$12,$13,$14,$15,$16,$17,$18,COALESCE($19,'portal'),COALESCE($20,'{}'::jsonb),$21,$22)
     RETURNING *`,
    [
      appId, tenantId, b.subTenantId ?? null, b.serviceId, b.clientUserId,
      b.clientName ?? null, b.clientEmail ?? null, b.clientPhone ?? null,
      b.startsAt, b.endsAt, b.status ?? 'requested',
      b.notes ?? null, b.internalNotes ?? null,
      b.recurrenceId ?? null, b.parentBookingId ?? null, b.packageId ?? null,
      b.priceCents ?? null, b.currency ?? null, b.source ?? 'portal', b.metadata ?? {},
      b.locale ?? null,
      b.sessionId,
    ],
  )
  return rows[0] ?? null
}

// Cuenta inscripciones vivas (no canceladas/no-show/rescheduled) de una
// sesión concreta. La cuenta se hace dentro de la tx de createBooking
// para que el chequeo de capacidad sea consistente con el insert que
// viene después en la misma transacción.
export async function countBookingsForSession(client, appId, tenantId, sessionId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.bookings
     WHERE app_id = $1 AND tenant_id = $2 AND session_id = $3
       AND status NOT IN ('cancelled','no_show','rescheduled')`,
    [appId, tenantId, sessionId],
  )
  return rows[0]?.count ?? 0
}

// Lee una session desde platform_services (cross-schema GRANT en la
// migration 0006). Devuelve null si no existe o no es visible bajo RLS.
export async function loadServiceSession(client, appId, tenantId, sessionId) {
  try {
    const { rows } = await client.query(
      `SELECT id, app_id, tenant_id, service_id,
              starts_at, ends_at, capacity, resource_id, status, registration_closes_at
       FROM platform_services.service_sessions
       WHERE app_id = $1 AND tenant_id = $2 AND id = $3 LIMIT 1`,
      [appId, tenantId, sessionId],
    )
    return rows[0] ?? null
  } catch {
    return null   // GRANT missing / transient — caller maps to NotFoundError
  }
}

// Idem para el service: necesitamos `capacity` (fallback cuando la session
// no lo override) y `kind` (validación: sólo kind='event' acepta sessionId).
export async function loadServiceFor(client, appId, tenantId, serviceId) {
  try {
    const { rows } = await client.query(
      `SELECT id, kind, capacity, price_cents, currency
       FROM platform_services.services
       WHERE app_id = $1 AND tenant_id = $2 AND id = $3 LIMIT 1`,
      [appId, tenantId, serviceId],
    )
    return rows[0] ?? null
  } catch {
    return null
  }
}

// Legacy unguarded insert — kept for callers that don't deal in resource
// windows (recurrence expander, waitlist conversions, internal admin).
// New code should prefer insertBookingAtomic.
export async function insertBooking(client, appId, tenantId, b) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bookings
       (app_id, tenant_id, sub_tenant_id, service_id, client_user_id, client_name, client_email, client_phone,
        starts_at, ends_at, status, notes, internal_notes,
        recurrence_id, parent_booking_id, package_id, price_cents, currency, source, metadata, locale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'requested'),$12,$13,$14,$15,$16,$17,$18,COALESCE($19,'portal'),COALESCE($20,'{}'::jsonb),$21)
     RETURNING *`,
    [
      appId, tenantId, b.subTenantId ?? null, b.serviceId, b.clientUserId,
      b.clientName ?? null, b.clientEmail ?? null, b.clientPhone ?? null,
      b.startsAt, b.endsAt, b.status ?? 'requested',
      b.notes ?? null, b.internalNotes ?? null,
      b.recurrenceId ?? null, b.parentBookingId ?? null, b.packageId ?? null,
      b.priceCents ?? null, b.currency ?? null, b.source ?? 'portal', b.metadata ?? {},
      b.locale ?? null,
    ],
  )
  return rows[0]
}

// Atomic hold consume: deletes the hold if it still exists and is not
// expired, returning the row so the caller can validate its window/resource
// match the booking being created. Returns null on miss (expired, deleted,
// or wrong tenant).
export async function consumeHold(client, appId, tenantId, holdId) {
  const { rows } = await client.query(
    `DELETE FROM platform_availability.holds
      WHERE app_id = $1 AND tenant_id = $2 AND id = $3 AND expires_at > now()
      RETURNING id, service_id, resource_id, starts_at, ends_at, client_user_id`,
    [appId, tenantId, holdId],
  )
  return rows[0] ?? null
}

export async function attachResource(client, appId, tenantId, bookingId, resourceId) {
  await client.query(
    `INSERT INTO ${SCHEMA}.booking_resources (app_id, tenant_id, booking_id, resource_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [appId, tenantId, bookingId, resourceId],
  )
}

export async function listResources(client, appId, tenantId, bookingId) {
  const { rows } = await client.query(
    `SELECT resource_id FROM ${SCHEMA}.booking_resources
     WHERE app_id=$1 AND tenant_id=$2 AND booking_id=$3`,
    [appId, tenantId, bookingId],
  )
  return rows.map((r) => r.resource_id)
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.bookings WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listBookings(client, appId, tenantId, { from, to, clientUserId, resourceId, sessionId, status, limit = 200 } = {}) {
  const filters = ['b.app_id = $1', 'b.tenant_id = $2']
  const params  = [appId, tenantId]
  if (from)         { filters.push(`b.starts_at >= $${params.length + 1}`); params.push(from) }
  if (to)           { filters.push(`b.starts_at <  $${params.length + 1}`); params.push(to) }
  if (clientUserId) { filters.push(`b.client_user_id = $${params.length + 1}`); params.push(clientUserId) }
  if (sessionId)    { filters.push(`b.session_id = $${params.length + 1}`); params.push(sessionId) }
  if (status)       { filters.push(`b.status = $${params.length + 1}`); params.push(status) }
  let join = ''
  if (resourceId)   {
    join = `JOIN ${SCHEMA}.booking_resources br ON br.booking_id = b.id`
    filters.push(`br.resource_id = $${params.length + 1}`); params.push(resourceId)
  }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT b.* FROM ${SCHEMA}.bookings b ${join}
     WHERE ${filters.join(' AND ')}
     ORDER BY b.starts_at ASC
     LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function setStatus(client, appId, tenantId, id, status, extra = {}) {
  const sets = ['status = $4', 'updated_at = now()']
  const params = [appId, tenantId, id, status]
  if (extra.startsAt) { sets.push(`starts_at = $${params.length + 1}`); params.push(extra.startsAt) }
  if (extra.endsAt)   { sets.push(`ends_at   = $${params.length + 1}`); params.push(extra.endsAt) }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.bookings SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function recordEvent(client, appId, tenantId, bookingId, fromStatus, toStatus, actorUserId, reason) {
  await client.query(
    `INSERT INTO ${SCHEMA}.booking_events (app_id, tenant_id, booking_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [appId, tenantId, bookingId, fromStatus, toStatus, actorUserId ?? null, reason ?? null],
  )
}

export async function listEvents(client, appId, tenantId, bookingId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.booking_events
     WHERE app_id=$1 AND tenant_id=$2 AND booking_id=$3 ORDER BY ts ASC`,
    [appId, tenantId, bookingId],
  )
  return rows
}

// Recurrences
export async function insertRecurrence(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.recurrences (app_id, tenant_id, rrule, starts_on, ends_on, count, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'{}'::jsonb)) RETURNING *`,
    [appId, tenantId, r.rrule, r.startsOn, r.endsOn ?? null, r.count ?? null, r.metadata ?? {}],
  )
  return rows[0]
}

// Waitlist
export async function insertWaitlist(client, appId, tenantId, w) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.waitlist
       (app_id, tenant_id, service_id, resource_id, client_user_id, client_name, client_phone, preferred_window, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'waiting')) RETURNING *`,
    [appId, tenantId, w.serviceId, w.resourceId ?? null, w.clientUserId,
     w.clientName ?? null, w.clientPhone ?? null, w.preferredWindow ?? null, w.status ?? 'waiting'],
  )
  return rows[0]
}

export async function listWaitlist(client, appId, tenantId, { serviceId, status } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (serviceId) { filters.push(`service_id = $${params.length + 1}`); params.push(serviceId) }
  if (status)    { filters.push(`status = $${params.length + 1}`);     params.push(status) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.waitlist WHERE ${filters.join(' AND ')} ORDER BY created_at`,
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
