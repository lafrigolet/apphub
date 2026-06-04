// SQL shape de platform_tenants.sub_tenants (#9 — segundo nivel de tenancy).
// Toda lectura/escritura va escopada por `tenant_id` (el padre), heredando el
// aislamiento (app_id, tenant_id) del tenant. El `slug` es único dentro del
// tenant padre, no globalmente.
const COLUMNS = `
  id, tenant_id, app_id, display_name, slug, status, created_at
`

export async function findByTenant(client, tenantId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM platform_tenants.sub_tenants
     WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId],
  )
  return rows
}

export async function findById(client, tenantId, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM platform_tenants.sub_tenants
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  )
  return rows[0] ?? null
}

export async function create(client, { tenantId, appId, displayName, slug }) {
  const { rows } = await client.query(
    `INSERT INTO platform_tenants.sub_tenants (tenant_id, app_id, display_name, slug)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [tenantId, appId, displayName, slug],
  )
  return rows[0]
}

const ALLOWED_UPDATE_FIELDS = {
  displayName: 'display_name',
  slug:        'slug',
  status:      'status',
}

export async function update(client, tenantId, id, fields) {
  const setters = []
  const values  = []
  let idx = 1
  for (const [key, column] of Object.entries(ALLOWED_UPDATE_FIELDS)) {
    if (fields[key] !== undefined) {
      setters.push(`${column} = $${idx++}`)
      values.push(fields[key])
    }
  }
  if (setters.length === 0) return findById(client, tenantId, id)
  values.push(tenantId, id)
  const { rows } = await client.query(
    `UPDATE platform_tenants.sub_tenants SET ${setters.join(', ')}
     WHERE tenant_id = $${idx++} AND id = $${idx}
     RETURNING ${COLUMNS}`,
    values,
  )
  return rows[0] ?? null
}

export async function remove(client, tenantId, id) {
  const { rows } = await client.query(
    `DELETE FROM platform_tenants.sub_tenants
     WHERE tenant_id = $1 AND id = $2
     RETURNING id`,
    [tenantId, id],
  )
  return rows[0] ?? null
}
