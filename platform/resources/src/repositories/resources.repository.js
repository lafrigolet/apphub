const SCHEMA = 'platform_resources'

export async function insert(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.resources
       (app_id, tenant_id, sub_tenant_id, user_id, kind, display_name, email, phone, bio,
        capacity, internal_rate_cents, is_active, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,1),$11,COALESCE($12,TRUE),COALESCE($13,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, r.subTenantId ?? null, r.userId ?? null,
      r.kind, r.displayName, r.email ?? null, r.phone ?? null, r.bio ?? null,
      r.capacity ?? 1, r.internalRateCents ?? null,
      r.isActive ?? true, r.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.resources WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listByTenant(client, appId, tenantId, { kind, onlyActive = true } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (kind)       { filters.push(`kind = $${params.length + 1}`); params.push(kind) }
  if (onlyActive) filters.push('is_active = TRUE')
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.resources WHERE ${filters.join(' AND ')} ORDER BY display_name`,
    params,
  )
  return rows
}

export async function listForService(client, appId, tenantId, serviceId) {
  const { rows } = await client.query(
    `SELECT r.* FROM ${SCHEMA}.resources r
     JOIN ${SCHEMA}.resource_services rs ON rs.resource_id = r.id
     WHERE r.app_id=$1 AND r.tenant_id=$2 AND rs.service_id=$3 AND r.is_active = TRUE
     ORDER BY r.display_name`,
    [appId, tenantId, serviceId],
  )
  return rows
}

export async function attachService(client, appId, tenantId, resourceId, serviceId) {
  await client.query(
    `INSERT INTO ${SCHEMA}.resource_services (app_id, tenant_id, resource_id, service_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [appId, tenantId, resourceId, serviceId],
  )
}

export async function detachService(client, appId, tenantId, resourceId, serviceId) {
  await client.query(
    `DELETE FROM ${SCHEMA}.resource_services
     WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3 AND service_id=$4`,
    [appId, tenantId, resourceId, serviceId],
  )
}

export async function listServicesFor(client, appId, tenantId, resourceId) {
  const { rows } = await client.query(
    `SELECT service_id FROM ${SCHEMA}.resource_services
     WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3`,
    [appId, tenantId, resourceId],
  )
  return rows.map((r) => r.service_id)
}

// Work hours
export async function insertWorkHours(client, appId, tenantId, w) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.work_hours
       (app_id, tenant_id, resource_id, day_of_week, start_minute, end_minute, effective_from, effective_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [appId, tenantId, w.resourceId, w.dayOfWeek, w.startMinute, w.endMinute,
     w.effectiveFrom ?? null, w.effectiveUntil ?? null],
  )
  return rows[0]
}

export async function listWorkHours(client, appId, tenantId, resourceId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.work_hours
     WHERE app_id=$1 AND tenant_id=$2 AND resource_id=$3
     ORDER BY day_of_week, start_minute`,
    [appId, tenantId, resourceId],
  )
  return rows
}

export async function deleteWorkHours(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.work_hours WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
}

// Exceptions
export async function insertException(client, appId, tenantId, e) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.exceptions
       (app_id, tenant_id, resource_id, starts_at, ends_at, kind, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [appId, tenantId, e.resourceId, e.startsAt, e.endsAt, e.kind, e.reason ?? null],
  )
  return rows[0]
}

export async function listExceptions(client, appId, tenantId, resourceId, { from, to } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2', 'resource_id = $3']
  const params  = [appId, tenantId, resourceId]
  if (from) { filters.push(`ends_at   >= $${params.length + 1}`); params.push(from) }
  if (to)   { filters.push(`starts_at <  $${params.length + 1}`); params.push(to) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.exceptions WHERE ${filters.join(' AND ')} ORDER BY starts_at`,
    params,
  )
  return rows
}
