const SCHEMA = 'platform_shipping'

// ── zones ─────────────────────────────────────────────────────────────────
export async function listZones(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipping_zones WHERE app_id=$1 AND tenant_id=$2 ORDER BY name`,
    [appId, tenantId],
  )
  return rows
}

export async function insertZone(client, appId, tenantId, z) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.shipping_zones (app_id, tenant_id, name, country_codes, region_codes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [appId, tenantId, z.name, z.countryCodes ?? [], z.regionCodes ?? []],
  )
  return rows[0]
}

// ── rates ─────────────────────────────────────────────────────────────────
export async function listRates(client, appId, tenantId, zoneId) {
  const params = [appId, tenantId]
  let where = 'app_id=$1 AND tenant_id=$2'
  if (zoneId) { where += ' AND zone_id=$3'; params.push(zoneId) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipping_rates WHERE ${where} ORDER BY price_cents`,
    params,
  )
  return rows
}

export async function insertRate(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.shipping_rates
       (app_id, tenant_id, zone_id, name, price_cents, min_weight_g, max_weight_g, eta_days_min, eta_days_max)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      appId, tenantId, r.zoneId ?? null, r.name, r.priceCents,
      r.minWeightG ?? 0, r.maxWeightG ?? null, r.etaDaysMin ?? null, r.etaDaysMax ?? null,
    ],
  )
  return rows[0]
}

export async function findRatesForCountry(client, appId, tenantId, country) {
  const { rows } = await client.query(
    `SELECT r.*, z.country_codes
       FROM ${SCHEMA}.shipping_rates r
       LEFT JOIN ${SCHEMA}.shipping_zones z ON z.id = r.zone_id
      WHERE r.app_id=$1 AND r.tenant_id=$2
        AND ($3::text IS NULL OR z.id IS NULL OR $3 = ANY (z.country_codes))
      ORDER BY r.price_cents`,
    [appId, tenantId, country ?? null],
  )
  return rows
}

// ── shipments ─────────────────────────────────────────────────────────────
export async function insertShipment(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.shipments
       (app_id, tenant_id, order_id, carrier, tracking_code, status, rate_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [appId, tenantId, s.orderId, s.carrier ?? null, s.trackingCode ?? null, s.status ?? 'pending', s.rateId ?? null, s.metadata ?? {}],
  )
  return rows[0]
}

export async function findShipmentById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipments WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findShipmentsByOrderId(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipments WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3`,
    [appId, tenantId, orderId],
  )
  return rows
}

export async function updateShipmentStatus(client, appId, tenantId, id, status, extra = {}) {
  const sets = ['status = $4']
  const params = [appId, tenantId, id, status]
  if (extra.shippedAt)   { sets.push(`shipped_at = $${params.length + 1}`);   params.push(extra.shippedAt) }
  if (extra.deliveredAt) { sets.push(`delivered_at = $${params.length + 1}`); params.push(extra.deliveredAt) }
  if (extra.trackingCode){ sets.push(`tracking_code = $${params.length + 1}`); params.push(extra.trackingCode) }
  if (extra.carrier)     { sets.push(`carrier = $${params.length + 1}`);      params.push(extra.carrier) }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.shipments SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3
     RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

// ── shipment events ───────────────────────────────────────────────────────
export async function insertShipmentEvent(client, appId, tenantId, shipmentId, e) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.shipment_events (app_id, tenant_id, shipment_id, code, description, location)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [appId, tenantId, shipmentId, e.code, e.description ?? null, e.location ?? null],
  )
  return rows[0]
}

export async function listShipmentEvents(client, appId, tenantId, shipmentId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipment_events
     WHERE app_id=$1 AND tenant_id=$2 AND shipment_id=$3 ORDER BY ts ASC`,
    [appId, tenantId, shipmentId],
  )
  return rows
}
