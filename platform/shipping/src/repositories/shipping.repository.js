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

export async function updateZone(client, appId, tenantId, id, z) {
  const sets = []
  const params = [appId, tenantId, id]
  if (z.name !== undefined)         { sets.push(`name = $${params.length + 1}`);          params.push(z.name) }
  if (z.countryCodes !== undefined) { sets.push(`country_codes = $${params.length + 1}`); params.push(z.countryCodes) }
  if (z.regionCodes !== undefined)  { sets.push(`region_codes = $${params.length + 1}`);  params.push(z.regionCodes) }
  if (sets.length === 0) return findZoneById(client, appId, tenantId, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.shipping_zones SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function findZoneById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipping_zones WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function deleteZone(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.shipping_zones WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
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
       (app_id, tenant_id, zone_id, name, price_cents, min_weight_g, max_weight_g,
        eta_days_min, eta_days_max, free_above_cents, service_level, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'standard'),COALESCE($12,TRUE)) RETURNING *`,
    [
      appId, tenantId, r.zoneId ?? null, r.name, r.priceCents,
      r.minWeightG ?? 0, r.maxWeightG ?? null, r.etaDaysMin ?? null, r.etaDaysMax ?? null,
      r.freeAboveCents ?? null, r.serviceLevel ?? null, r.active ?? null,
    ],
  )
  return rows[0]
}

export async function findRateById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipping_rates WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function updateRate(client, appId, tenantId, id, r) {
  const cols = {
    zone_id: r.zoneId, name: r.name, price_cents: r.priceCents,
    min_weight_g: r.minWeightG, max_weight_g: r.maxWeightG,
    eta_days_min: r.etaDaysMin, eta_days_max: r.etaDaysMax,
    free_above_cents: r.freeAboveCents, service_level: r.serviceLevel, active: r.active,
  }
  const sets = []
  const params = [appId, tenantId, id]
  for (const [col, val] of Object.entries(cols)) {
    if (val !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(val) }
  }
  if (sets.length === 0) return findRateById(client, appId, tenantId, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.shipping_rates SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function deleteRate(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.shipping_rates WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
}

// Quote: applies country, weight (min/max_weight_g), and active filters.
// free_above_cents is applied in the service layer so the original
// price_cents stays visible alongside the effective (possibly 0) price.
export async function findRatesForCountry(client, appId, tenantId, { country, weightG } = {}) {
  const { rows } = await client.query(
    `SELECT r.*, z.country_codes
       FROM ${SCHEMA}.shipping_rates r
       LEFT JOIN ${SCHEMA}.shipping_zones z ON z.id = r.zone_id
      WHERE r.app_id=$1 AND r.tenant_id=$2
        AND r.active = TRUE
        AND ($3::text IS NULL OR z.id IS NULL OR $3 = ANY (z.country_codes))
        AND ($4::int  IS NULL OR (
              r.min_weight_g <= $4 AND ($4 <= r.max_weight_g OR r.max_weight_g IS NULL)))
      ORDER BY r.price_cents`,
    [appId, tenantId, country ?? null, weightG ?? null],
  )
  return rows
}

// ── shipments ─────────────────────────────────────────────────────────────
export async function insertShipment(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.shipments
       (app_id, tenant_id, order_id, carrier, tracking_code, status, rate_id, metadata,
        insurance_amount_cents, insurance_currency, signature_required, estimated_delivery_date,
        from_address_id, to_address_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,FALSE),$12,$13,$14) RETURNING *`,
    [
      appId, tenantId, s.orderId, s.carrier ?? null, s.trackingCode ?? null,
      s.status ?? 'pending', s.rateId ?? null, s.metadata ?? {},
      s.insuranceAmountCents ?? null, s.insuranceCurrency ?? null,
      s.signatureRequired ?? false, s.estimatedDeliveryDate ?? null,
      s.fromAddressId ?? null, s.toAddressId ?? null,
    ],
  )
  return rows[0]
}

// List shipments with optional filters: status, carrier, orderId, createdSince.
export async function listShipments(client, appId, tenantId, f = {}) {
  const params = [appId, tenantId]
  let where = 'app_id=$1 AND tenant_id=$2'
  if (f.status)       { where += ` AND status = $${params.length + 1}`;     params.push(f.status) }
  if (f.carrier)      { where += ` AND carrier = $${params.length + 1}`;    params.push(f.carrier) }
  if (f.orderId)      { where += ` AND order_id = $${params.length + 1}`;   params.push(f.orderId) }
  if (f.createdSince) { where += ` AND created_at >= $${params.length + 1}`; params.push(f.createdSince) }
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipments WHERE ${where}
       ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  )
  return rows
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

// ── packages (multi-package shipments) ───────────────────────────────────
export async function insertPackage(client, appId, tenantId, shipmentId, p) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.shipment_packages
       (app_id, tenant_id, shipment_id, package_number, carrier, tracking_code,
        weight_grams, length_mm, width_mm, height_mm, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'pending'),COALESCE($12,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, shipmentId, p.packageNumber,
      p.carrier ?? null, p.trackingCode ?? null,
      p.weightGrams ?? null, p.lengthMm ?? null, p.widthMm ?? null, p.heightMm ?? null,
      p.status ?? 'pending', p.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function listPackages(client, appId, tenantId, shipmentId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipment_packages
       WHERE app_id=$1 AND tenant_id=$2 AND shipment_id=$3
       ORDER BY package_number`,
    [appId, tenantId, shipmentId],
  )
  return rows
}

export async function findPackageByTracking(client, appId, tenantId, trackingCode) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipment_packages
       WHERE app_id=$1 AND tenant_id=$2 AND tracking_code=$3
       LIMIT 1`,
    [appId, tenantId, trackingCode],
  )
  return rows[0] ?? null
}

export async function updatePackageStatus(client, appId, tenantId, packageId, status, extra = {}) {
  const sets = ['status = $4']
  const params = [appId, tenantId, packageId, status]
  if (extra.shippedAt)   { sets.push(`shipped_at = $${params.length + 1}`);   params.push(extra.shippedAt) }
  if (extra.deliveredAt) { sets.push(`delivered_at = $${params.length + 1}`); params.push(extra.deliveredAt) }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.shipment_packages SET ${sets.join(', ')}
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

// Persist the label artifacts on a package after an EasyPost label purchase.
export async function updatePackageLabel(client, appId, tenantId, packageId, l) {
  const cols = {
    carrier: l.carrier, tracking_code: l.trackingCode, status: l.status,
    easypost_shipment_id: l.easypostShipmentId, easypost_rate_id: l.easypostRateId,
    label_url: l.labelUrl, label_s3_key: l.labelS3Key, tracking_url: l.trackingUrl,
    rate_cents: l.rateCents, rate_currency: l.rateCurrency,
  }
  const sets = []
  const params = [appId, tenantId, packageId]
  for (const [col, val] of Object.entries(cols)) {
    if (val !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(val) }
  }
  if (sets.length === 0) return null
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.shipment_packages SET ${sets.join(', ')}
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function findPackageById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.shipment_packages WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// Link a shipment to its from/to addresses and the parent EasyPost shipment id,
// and optionally set the resolved carrier/tracking after a label purchase.
export async function updateShipmentFulfillment(client, appId, tenantId, id, f) {
  const cols = {
    from_address_id: f.fromAddressId, to_address_id: f.toAddressId,
    easypost_shipment_id: f.easypostShipmentId, carrier: f.carrier, tracking_code: f.trackingCode,
  }
  const sets = []
  const params = [appId, tenantId, id]
  for (const [col, val] of Object.entries(cols)) {
    if (val !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(val) }
  }
  if (sets.length === 0) return findShipmentById(client, appId, tenantId, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.shipments SET ${sets.join(', ')}
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function nextPackageNumber(client, appId, tenantId, shipmentId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(package_number), 0) + 1 AS next
       FROM ${SCHEMA}.shipment_packages
      WHERE app_id=$1 AND tenant_id=$2 AND shipment_id=$3`,
    [appId, tenantId, shipmentId],
  )
  return Number(rows[0]?.next ?? 1)
}

// ── carrier webhook events (idempotent) ─────────────────────────────────
export async function insertWebhookEvent(client, e) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.carrier_webhook_events
       (app_id, tenant_id, carrier, event_external_id, shipment_id, package_id, payload, signature_valid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (carrier, event_external_id) DO NOTHING
     RETURNING *`,
    [
      e.appId ?? null, e.tenantId ?? null, e.carrier, e.eventExternalId ?? null,
      e.shipmentId ?? null, e.packageId ?? null, e.payload ?? {}, e.signatureValid ?? null,
    ],
  )
  return rows[0] ?? null   // null on duplicate (idempotent suppression)
}

export async function markWebhookProcessed(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.carrier_webhook_events SET processed_at = now() WHERE id = $1`,
    [id],
  )
}
