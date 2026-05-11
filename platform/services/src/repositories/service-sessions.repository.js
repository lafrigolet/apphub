// Repository de platform_services.service_sessions. Las queries pasan
// dentro de withTenantTransaction → RLS scopea por (app_id, tenant_id).
// `listUpcomingPublic` también va dentro de withTenantTransaction (con
// el appId/tenantId que llega del query string público); RLS hace
// cumplir el aislamiento aunque alguien intente inyectar otro tenant.

const SCHEMA = 'platform_services'
const COLS = `id, app_id, tenant_id, sub_tenant_id, service_id,
              starts_at, ends_at, capacity, resource_id, price_cents, currency,
              location, status, description, registration_closes_at, metadata,
              created_at, updated_at`

export async function insert(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.service_sessions
       (app_id, tenant_id, sub_tenant_id, service_id, starts_at, ends_at,
        capacity, resource_id, price_cents, currency, location, status,
        description, registration_closes_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             COALESCE($12, 'scheduled'), $13, $14, COALESCE($15, '{}'::jsonb))
     RETURNING ${COLS}`,
    [
      appId, tenantId, s.subTenantId ?? null, s.serviceId,
      s.startsAt, s.endsAt,
      s.capacity ?? null, s.resourceId ?? null,
      s.priceCents ?? null, s.currency ?? null,
      s.location ?? null, s.status ?? null,
      s.description ?? null, s.registrationClosesAt ?? null,
      s.metadata ?? null,
    ],
  )
  return rows[0]
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.service_sessions
     WHERE app_id = $1 AND tenant_id = $2 AND id = $3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listByService(client, appId, tenantId, serviceId, { fromDate, includeCancelled = false } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2', 'service_id = $3']
  const params  = [appId, tenantId, serviceId]
  if (fromDate)        { filters.push(`starts_at >= $${params.length + 1}`); params.push(fromDate) }
  if (!includeCancelled) filters.push(`status <> 'cancelled'`)
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.service_sessions
     WHERE ${filters.join(' AND ')}
     ORDER BY starts_at ASC`,
    params,
  )
  return rows
}

const UPDATE_MAP = {
  startsAt:               'starts_at',
  endsAt:                 'ends_at',
  capacity:               'capacity',
  resourceId:             'resource_id',
  priceCents:             'price_cents',
  currency:               'currency',
  location:               'location',
  status:                 'status',
  description:            'description',
  registrationClosesAt:   'registration_closes_at',
  metadata:               'metadata',
}

export async function update(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  for (const [k, col] of Object.entries(UPDATE_MAP)) {
    if (patch[k] !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(patch[k]) }
  }
  if (!sets.length) return findById(client, appId, tenantId, id)
  sets.push('updated_at = now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.service_sessions SET ${sets.join(', ')}
     WHERE app_id = $1 AND tenant_id = $2 AND id = $3 RETURNING ${COLS}`,
    params,
  )
  return rows[0] ?? null
}

export async function cancel(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.service_sessions SET status = 'cancelled', updated_at = now()
     WHERE app_id = $1 AND tenant_id = $2 AND id = $3 RETURNING ${COLS}`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// Catálogo público: lista sesiones futuras de servicios con
// public_catalog=TRUE para un (appId, tenantId) dado. La llamada se
// hace con tenant context puesto por withTenantTransaction; RLS sigue
// scopeando por current_setting, así que los WHERE de tenant son
// redundantes pero los dejamos como defensa (y para que el plan sea
// más rápido cuando RLS añade su filtro implícito).
export async function listUpcomingPublic(client, appId, tenantId, { limit = 50, kind } = {}) {
  const filters = ['ss.app_id = $1', 'ss.tenant_id = $2',
                   `ss.status = 'scheduled'`, 'ss.starts_at > now()',
                   's.public_catalog = TRUE', 's.is_active = TRUE']
  const params  = [appId, tenantId]
  if (kind) { filters.push(`s.kind = $${params.length + 1}`); params.push(kind) }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 500))
  const { rows } = await client.query(
    `SELECT ss.id, ss.service_id, ss.starts_at, ss.ends_at,
            ss.capacity, ss.location, ss.description AS session_description,
            ss.price_cents AS session_price_cents, ss.currency AS session_currency,
            s.name        AS service_name,
            s.description AS service_description,
            s.kind        AS service_kind,
            s.price_cents AS service_price_cents,
            s.currency    AS service_currency,
            s.capacity    AS service_capacity
     FROM ${SCHEMA}.service_sessions ss
     JOIN ${SCHEMA}.services s ON s.id = ss.service_id
     WHERE ${filters.join(' AND ')}
     ORDER BY ss.starts_at ASC
     LIMIT $${params.length}`,
    params,
  )
  return rows
}
