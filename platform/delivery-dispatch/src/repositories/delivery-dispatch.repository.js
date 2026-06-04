const SCHEMA = 'platform_delivery_dispatch'

export async function insertZone(client, z) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.zones (app_id, tenant_id, name, polygon, base_fee_cents, per_km_cents, min_order_cents, is_active)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),COALESCE($6,0),COALESCE($7,0),COALESCE($8,TRUE)) RETURNING *`,
    [z.appId, z.tenantId, z.name, JSON.stringify(z.polygon),
     z.baseFeeCents ?? 0, z.perKmCents ?? 0, z.minOrderCents ?? 0, z.isActive ?? true],
  )
  return rows[0]
}

export async function listZones(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.zones WHERE app_id=$1 AND tenant_id=$2 ORDER BY name`,
    [appId, tenantId],
  )
  return rows
}

export async function findZoneById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.zones WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listActiveZones(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.zones WHERE app_id=$1 AND tenant_id=$2 AND is_active=TRUE ORDER BY name`,
    [appId, tenantId],
  )
  return rows
}

const ZONE_COLS = {
  name:          'name',
  baseFeeCents:  'base_fee_cents',
  perKmCents:    'per_km_cents',
  minOrderCents: 'min_order_cents',
  isActive:      'is_active',
}

export async function updateZone(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  let i = 4
  for (const [key, col] of Object.entries(ZONE_COLS)) {
    if (patch[key] === undefined) continue
    const v = key === 'polygon' ? JSON.stringify(patch[key]) : patch[key]
    sets.push(`${col}=$${i++}`); params.push(v)
  }
  if (patch.polygon !== undefined) { sets.push(`polygon=$${i++}`); params.push(JSON.stringify(patch.polygon)) }
  if (sets.length === 0) return findZoneById(client, appId, tenantId, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.zones SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function deleteZone(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `DELETE FROM ${SCHEMA}.zones WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING id`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function insertRider(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.riders (app_id, tenant_id, user_id, display_name, phone, vehicle, status)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'offline')) RETURNING *`,
    [r.appId, r.tenantId, r.userId ?? null, r.displayName, r.phone ?? null, r.vehicle ?? null, r.status ?? 'offline'],
  )
  return rows[0]
}

export async function listRiders(client, appId, tenantId, { status, includeDeleted = false } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (status) { filters.push(`status = $${i++}`); params.push(status) }
  if (!includeDeleted) filters.push('deleted_at IS NULL')
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.riders WHERE ${filters.join(' AND ')} ORDER BY display_name`,
    params,
  )
  return rows
}

export async function findRiderById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.riders WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

const RIDER_COLS = {
  displayName: 'display_name',
  phone:       'phone',
  vehicle:     'vehicle',
  status:      'status',
  userId:      'user_id',
}

export async function updateRider(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  let i = 4
  for (const [key, col] of Object.entries(RIDER_COLS)) {
    if (patch[key] === undefined) continue
    sets.push(`${col}=$${i++}`); params.push(patch[key])
  }
  if (sets.length === 0) return findRiderById(client, appId, tenantId, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.riders SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 AND deleted_at IS NULL RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function softDeleteRider(client, appId, tenantId, id, reason) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.riders
     SET deleted_at=now(), deleted_reason=$4, status='offline'
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 AND deleted_at IS NULL RETURNING *`,
    [appId, tenantId, id, reason ?? null],
  )
  return rows[0] ?? null
}

export async function updateRiderLocation(client, appId, tenantId, id, { lat, lng, status }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.riders
     SET last_lat=$4, last_lng=$5, last_seen_at=now(), status=COALESCE($6,status)
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, lat, lng, status ?? null],
  )
  return rows[0] ?? null
}

export async function insertDelivery(client, d) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.deliveries
       (app_id, tenant_id, order_id, carrier, external_ref, zone_id,
        pickup_address, drop_address, fee_cents, status, estimated_minutes)
     VALUES ($1,$2,$3,COALESCE($4,'own'),$5,$6,$7,$8,COALESCE($9,0),COALESCE($10,'pending'),$11)
     RETURNING *`,
    [d.appId, d.tenantId, d.orderId, d.carrier ?? 'own', d.externalRef ?? null,
     d.zoneId ?? null, JSON.stringify(d.pickupAddress ?? null), JSON.stringify(d.dropAddress),
     d.feeCents ?? 0, d.status ?? 'pending', d.estimatedMinutes ?? null],
  )
  return rows[0]
}

export async function findDeliveryById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.deliveries WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findDeliveryByExternalRef(client, appId, tenantId, carrier, externalRef) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.deliveries
     WHERE app_id=$1 AND tenant_id=$2 AND carrier=$3 AND external_ref=$4
     ORDER BY created_at DESC LIMIT 1`,
    [appId, tenantId, carrier, externalRef],
  )
  return rows[0] ?? null
}

export async function listDeliveries(client, appId, tenantId, { status, riderId, limit = 100 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (status)  { filters.push(`status = $${i++}`);   params.push(status) }
  if (riderId) { filters.push(`rider_id = $${i++}`); params.push(riderId) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.deliveries WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${i++}`,
    params,
  )
  return rows
}

export async function assignRider(client, appId, tenantId, deliveryId, riderId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.deliveries SET rider_id=$4, status='dispatched', dispatched_at=now(), updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, deliveryId, riderId],
  )
  return rows[0] ?? null
}

export async function setDeliveryStatus(client, appId, tenantId, id, status, tsCol) {
  const set = tsCol ? `status=$4, ${tsCol}=now(), updated_at=now()` : `status=$4, updated_at=now()`
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.deliveries SET ${set}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

export async function insertDeliveryEvent(client, e) {
  await client.query(
    `INSERT INTO ${SCHEMA}.delivery_events (app_id, tenant_id, delivery_id, event_type, lat, lng, payload)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'{}'::jsonb))`,
    [e.appId, e.tenantId, e.deliveryId, e.eventType, e.lat ?? null, e.lng ?? null,
     JSON.stringify(e.payload ?? {})],
  )
}

export async function listDeliveryEvents(client, appId, tenantId, deliveryId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.delivery_events WHERE app_id=$1 AND tenant_id=$2 AND delivery_id=$3
     ORDER BY ts ASC`,
    [appId, tenantId, deliveryId],
  )
  return rows
}
