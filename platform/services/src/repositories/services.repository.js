const SCHEMA = 'platform_services'

export async function insert(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.services
       (app_id, tenant_id, sub_tenant_id, code, name, description, category, modality,
        duration_minutes, buffer_before_minutes, buffer_after_minutes,
        price_cents, currency, cancellation_policy,
        requires_intake_form, intake_form_id, capacity, min_age, metadata, is_active,
        kind, public_catalog, min_advance_minutes, max_advance_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'in_person'),
             $9,COALESCE($10,0),COALESCE($11,0),
             COALESCE($12,0),COALESCE($13,'EUR'),COALESCE($14,'{}'::jsonb),
             COALESCE($15,FALSE),$16,COALESCE($17,1),$18,COALESCE($19,'{}'::jsonb),COALESCE($20,TRUE),
             COALESCE($21,'appointment'),COALESCE($22,FALSE),COALESCE($23,0),$24)
     RETURNING *`,
    [
      appId, tenantId, s.subTenantId ?? null, s.code, s.name, s.description ?? null, s.category ?? null,
      s.modality ?? 'in_person',
      s.durationMinutes, s.bufferBeforeMinutes ?? 0, s.bufferAfterMinutes ?? 0,
      s.priceCents ?? 0, s.currency ?? 'EUR', s.cancellationPolicy ?? {},
      s.requiresIntakeForm ?? false, s.intakeFormId ?? null,
      s.capacity ?? 1, s.minAge ?? null, s.metadata ?? {}, s.isActive ?? true,
      s.kind ?? 'appointment', s.publicCatalog ?? false,
      s.minAdvanceMinutes ?? 0, s.maxAdvanceDays ?? null,
    ],
  )
  return rows[0]
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.services WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listByTenant(client, appId, tenantId, { onlyActive = true, category } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (onlyActive) filters.push('is_active = TRUE')
  if (category)   { filters.push(`category = $${params.length + 1}`); params.push(category) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.services WHERE ${filters.join(' AND ')} ORDER BY name`,
    params,
  )
  return rows
}

export async function update(client, appId, tenantId, id, patch) {
  const map = {
    name: 'name', description: 'description', category: 'category', modality: 'modality',
    durationMinutes: 'duration_minutes', bufferBeforeMinutes: 'buffer_before_minutes',
    bufferAfterMinutes: 'buffer_after_minutes',
    priceCents: 'price_cents', currency: 'currency', cancellationPolicy: 'cancellation_policy',
    requiresIntakeForm: 'requires_intake_form', intakeFormId: 'intake_form_id',
    capacity: 'capacity', minAge: 'min_age', metadata: 'metadata', isActive: 'is_active',
    kind: 'kind', publicCatalog: 'public_catalog',
    minAdvanceMinutes: 'min_advance_minutes', maxAdvanceDays: 'max_advance_days',
  }
  const sets = []
  const params = [appId, tenantId, id]
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(patch[k]) }
  }
  if (!sets.length) return findById(client, appId, tenantId, id)
  sets.push('updated_at = now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.services SET ${sets.join(', ')} WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function deactivate(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.services SET is_active = FALSE, updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function insertCategory(client, appId, tenantId, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.categories (app_id, tenant_id, name, display_order)
     VALUES ($1,$2,$3,COALESCE($4,0)) RETURNING *`,
    [appId, tenantId, c.name, c.displayOrder ?? 0],
  )
  return rows[0]
}

export async function listCategories(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.categories WHERE app_id=$1 AND tenant_id=$2 ORDER BY display_order, name`,
    [appId, tenantId],
  )
  return rows
}

// ── Photo gallery (object_id ref into platform_storage) ─────────────────

export async function listImages(client, appId, tenantId, serviceId) {
  const { rows } = await client.query(
    `SELECT id, service_id, object_id, alt_text, display_order, created_at
       FROM platform_services.service_images
       WHERE app_id=$1 AND tenant_id=$2 AND service_id=$3
       ORDER BY display_order, created_at`,
    [appId, tenantId, serviceId],
  )
  return rows
}

export async function insertImage(client, appId, tenantId, serviceId, { objectId, altText, displayOrder }) {
  const { rows } = await client.query(
    `INSERT INTO platform_services.service_images
       (app_id, tenant_id, service_id, object_id, alt_text, display_order)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0))
     RETURNING *`,
    [appId, tenantId, serviceId, objectId, altText ?? null, displayOrder ?? 0],
  )
  return rows[0]
}

export async function deleteImage(client, appId, tenantId, imageId) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_services.service_images
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, imageId],
  )
  return rowCount > 0
}

// ── Pricing tiers ───────────────────────────────────────────────────────

export async function listPricingTiers(client, appId, tenantId, serviceId) {
  const { rows } = await client.query(
    `SELECT * FROM platform_services.service_pricing_tiers
       WHERE app_id=$1 AND tenant_id=$2 AND service_id=$3
       ORDER BY created_at`,
    [appId, tenantId, serviceId],
  )
  return rows
}

export async function insertPricingTier(client, appId, tenantId, serviceId, t) {
  const { rows } = await client.query(
    `INSERT INTO platform_services.service_pricing_tiers
       (app_id, tenant_id, service_id, label, days_of_week, start_minute, end_minute, price_cents, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE))
     RETURNING *`,
    [
      appId, tenantId, serviceId, t.label,
      t.daysOfWeek ?? null,
      t.startMinute ?? null,
      t.endMinute ?? null,
      t.priceCents,
      t.enabled,
    ],
  )
  return rows[0]
}

export async function deletePricingTier(client, appId, tenantId, tierId) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_services.service_pricing_tiers
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, tierId],
  )
  return rowCount > 0
}

// ── i18n translations ─────────────────────────────────────────────────────

export async function listTranslations(client, appId, tenantId, serviceId) {
  const { rows } = await client.query(
    `SELECT id, service_id, locale, name, description, created_at, updated_at
       FROM platform_services.service_translations
       WHERE app_id=$1 AND tenant_id=$2 AND service_id=$3
       ORDER BY locale`,
    [appId, tenantId, serviceId],
  )
  return rows
}

// Upsert: a (service_id, locale) pair is unique. Re-posting the same locale
// overwrites name/description rather than erroring — translations are a
// natural "set this value" operation.
export async function upsertTranslation(client, appId, tenantId, serviceId, { locale, name, description }) {
  const { rows } = await client.query(
    `INSERT INTO platform_services.service_translations
       (app_id, tenant_id, service_id, locale, name, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (app_id, tenant_id, service_id, locale)
       DO UPDATE SET name = EXCLUDED.name,
                     description = EXCLUDED.description,
                     updated_at = now()
     RETURNING id, service_id, locale, name, description, created_at, updated_at`,
    [appId, tenantId, serviceId, locale, name ?? null, description ?? null],
  )
  return rows[0]
}

export async function deleteTranslation(client, appId, tenantId, serviceId, locale) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_services.service_translations
       WHERE app_id=$1 AND tenant_id=$2 AND service_id=$3 AND locale=$4`,
    [appId, tenantId, serviceId, locale],
  )
  return rowCount > 0
}

// Map of serviceId → { name, description } for one locale, used to localize
// the public catalog in a single round trip.
export async function translationsForServices(client, appId, tenantId, serviceIds, locale) {
  if (!serviceIds.length) return new Map()
  const { rows } = await client.query(
    `SELECT service_id, name, description
       FROM platform_services.service_translations
       WHERE app_id=$1 AND tenant_id=$2 AND locale=$3 AND service_id = ANY($4::uuid[])`,
    [appId, tenantId, locale, serviceIds],
  )
  const map = new Map()
  for (const r of rows) map.set(r.service_id, { name: r.name, description: r.description })
  return map
}
