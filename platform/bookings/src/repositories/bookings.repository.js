const SCHEMA = 'platform_bookings'

export async function insertBooking(client, appId, tenantId, b) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.bookings
       (app_id, tenant_id, sub_tenant_id, service_id, client_user_id, client_name, client_email, client_phone,
        starts_at, ends_at, status, notes, internal_notes,
        recurrence_id, parent_booking_id, package_id, price_cents, currency, source, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'requested'),$12,$13,$14,$15,$16,$17,$18,COALESCE($19,'portal'),COALESCE($20,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, b.subTenantId ?? null, b.serviceId, b.clientUserId,
      b.clientName ?? null, b.clientEmail ?? null, b.clientPhone ?? null,
      b.startsAt, b.endsAt, b.status ?? 'requested',
      b.notes ?? null, b.internalNotes ?? null,
      b.recurrenceId ?? null, b.parentBookingId ?? null, b.packageId ?? null,
      b.priceCents ?? null, b.currency ?? null, b.source ?? 'portal', b.metadata ?? {},
    ],
  )
  return rows[0]
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

export async function listBookings(client, appId, tenantId, { from, to, clientUserId, resourceId, status, limit = 200 } = {}) {
  const filters = ['b.app_id = $1', 'b.tenant_id = $2']
  const params  = [appId, tenantId]
  if (from)         { filters.push(`b.starts_at >= $${params.length + 1}`); params.push(from) }
  if (to)           { filters.push(`b.starts_at <  $${params.length + 1}`); params.push(to) }
  if (clientUserId) { filters.push(`b.client_user_id = $${params.length + 1}`); params.push(clientUserId) }
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
