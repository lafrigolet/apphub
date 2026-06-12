const SCHEMA = 'platform_shipping'

const COLS = {
  role: 'role', label: 'label', name: 'name', company: 'company', phone: 'phone',
  email: 'email', street1: 'street1', street2: 'street2', city: 'city',
  region: 'region', zip: 'zip', country: 'country', isDefault: 'is_default',
  verified: 'verified', easypostAddressId: 'easypost_address_id', metadata: 'metadata',
}

export async function insertAddress(client, appId, tenantId, a) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.addresses
       (app_id, tenant_id, role, label, name, company, phone, email,
        street1, street2, city, region, zip, country, is_default, metadata)
     VALUES ($1,$2,COALESCE($3,'destination'),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,FALSE),COALESCE($16,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, a.role ?? null, a.label ?? null, a.name ?? null, a.company ?? null,
      a.phone ?? null, a.email ?? null, a.street1, a.street2 ?? null, a.city,
      a.region ?? null, a.zip ?? null, a.country, a.isDefault ?? null, a.metadata ?? null,
    ],
  )
  return rows[0]
}

export async function listAddresses(client, appId, tenantId, { role } = {}) {
  const params = [appId, tenantId]
  let where = 'app_id=$1 AND tenant_id=$2'
  if (role) { where += ` AND role = $${params.length + 1}`; params.push(role) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.addresses WHERE ${where} ORDER BY is_default DESC, created_at DESC`,
    params,
  )
  return rows
}

export async function findAddressById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.addresses WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// The default ship-from origin for the tenant (used when a caller omits
// fromAddressId). Falls back to the most recent origin when none is flagged.
export async function findDefaultOrigin(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.addresses
      WHERE app_id=$1 AND tenant_id=$2 AND role='origin'
      ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [appId, tenantId],
  )
  return rows[0] ?? null
}

export async function updateAddress(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  for (const [field, col] of Object.entries(COLS)) {
    if (patch[field] !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(patch[field]) }
  }
  if (sets.length === 0) return findAddressById(client, appId, tenantId, id)
  sets.push('updated_at = now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.addresses SET ${sets.join(', ')}
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

// Clear is_default on existing origins so a freshly-flagged default can win
// (paired with the partial unique index in migration 0006). Must run BEFORE the
// insert/update that sets the new default, or the index rejects it. exceptId
// (the row being kept as default) is left untouched; null clears all.
export async function clearDefaultOrigin(client, appId, tenantId, exceptId = null) {
  await client.query(
    `UPDATE ${SCHEMA}.addresses SET is_default = FALSE, updated_at = now()
      WHERE app_id=$1 AND tenant_id=$2 AND role='origin' AND is_default = TRUE
        AND ($3::uuid IS NULL OR id <> $3)`,
    [appId, tenantId, exceptId],
  )
}

export async function deleteAddress(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.addresses WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
}
