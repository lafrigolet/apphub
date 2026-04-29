// Availability is a read-mostly module: it queries resources/bookings from
// other schemas (read-only) and writes its own short-lived holds.

const SCHEMA = 'platform_availability'

export async function getServiceById(client, appId, tenantId, serviceId) {
  const { rows } = await client.query(
    `SELECT id, duration_minutes, buffer_before_minutes, buffer_after_minutes, capacity, modality
     FROM platform_services.services
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, serviceId],
  )
  return rows[0] ?? null
}

export async function getResourcesForService(client, appId, tenantId, serviceId) {
  const { rows } = await client.query(
    `SELECT r.id, r.display_name, r.capacity, r.kind
     FROM platform_resources.resources r
     JOIN platform_resources.resource_services rs ON rs.resource_id = r.id
     WHERE r.app_id=$1 AND r.tenant_id=$2 AND rs.service_id=$3 AND r.is_active = TRUE
     ORDER BY r.display_name`,
    [appId, tenantId, serviceId],
  )
  return rows
}

export async function getWorkHours(client, appId, tenantId, resourceId) {
  const { rows } = await client.query(
    `SELECT day_of_week, start_minute, end_minute, effective_from, effective_until
     FROM platform_resources.work_hours
     WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3`,
    [appId, tenantId, resourceId],
  )
  return rows
}

export async function getExceptions(client, appId, tenantId, resourceId, fromIso, toIso) {
  const { rows } = await client.query(
    `SELECT starts_at, ends_at FROM platform_resources.exceptions
     WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3
       AND ends_at > $4 AND starts_at < $5`,
    [appId, tenantId, resourceId, fromIso, toIso],
  )
  return rows
}

export async function getBusyBookings(client, appId, tenantId, resourceId, fromIso, toIso) {
  const { rows } = await client.query(
    `SELECT b.starts_at, b.ends_at
     FROM platform_bookings.bookings b
     JOIN platform_bookings.booking_resources br ON br.booking_id = b.id
     WHERE b.app_id=$1 AND b.tenant_id=$2 AND br.resource_id=$3
       AND b.status NOT IN ('cancelled','no_show','rescheduled','completed')
       AND b.ends_at > $4 AND b.starts_at < $5`,
    [appId, tenantId, resourceId, fromIso, toIso],
  )
  return rows
}

export async function getActiveHolds(client, appId, tenantId, resourceId, fromIso, toIso) {
  const { rows } = await client.query(
    `SELECT starts_at, ends_at FROM ${SCHEMA}.holds
     WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3
       AND expires_at > now()
       AND ends_at > $4 AND starts_at < $5`,
    [appId, tenantId, resourceId, fromIso, toIso],
  )
  return rows
}

// Atomic hold insert — only succeeds if no overlapping non-expired hold or booking exists.
export async function insertHoldAtomic(client, appId, tenantId, h) {
  const { rows } = await client.query(
    `WITH overlapping_holds AS (
       SELECT 1 FROM ${SCHEMA}.holds
       WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3
         AND expires_at > now()
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($4::timestamptz, $5::timestamptz, '[)')
     ),
     overlapping_bookings AS (
       SELECT 1
       FROM platform_bookings.bookings b
       JOIN platform_bookings.booking_resources br ON br.booking_id = b.id
       WHERE b.app_id=$1 AND b.tenant_id=$2 AND br.resource_id=$3
         AND b.status NOT IN ('cancelled','no_show','rescheduled','completed')
         AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange($4::timestamptz, $5::timestamptz, '[)')
     )
     INSERT INTO ${SCHEMA}.holds (app_id, tenant_id, service_id, resource_id, starts_at, ends_at, client_user_id, expires_at)
     SELECT $1, $2, $6, $3, $4, $5, $7, now() + ($8 || ' seconds')::interval
     WHERE NOT EXISTS (SELECT 1 FROM overlapping_holds)
       AND NOT EXISTS (SELECT 1 FROM overlapping_bookings)
     RETURNING *`,
    [appId, tenantId, h.resourceId, h.startsAt, h.endsAt, h.serviceId, h.clientUserId ?? null, String(h.ttlSeconds ?? 300)],
  )
  return rows[0] ?? null
}

export async function deleteHold(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.holds WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
}

export async function purgeExpiredHolds(client, appId, tenantId) {
  await client.query(
    `DELETE FROM ${SCHEMA}.holds WHERE app_id=$1 AND tenant_id=$2 AND expires_at <= now()`,
    [appId, tenantId],
  )
}
