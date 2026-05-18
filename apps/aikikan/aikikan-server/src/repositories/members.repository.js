// Repository for app_aikikan.members. Receives a `client` already inside
// withTenantTransaction (so RLS context is set). Never reaches across
// into platform_* schemas — those are accessed via HTTP / events from
// the service layer.

const TABLE = 'app_aikikan.members'

const COLUMNS = `
  user_id, app_id, tenant_id, sub_tenant_id,
  member_number, member_since, aikido_grade, dojo_name, notes,
  created_at, updated_at
`

export async function findByUserId(client, userId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${TABLE} WHERE user_id = $1 LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

export async function findAll(client) {
  // RLS scope viene del client (withTenantTransaction lo configura). El
  // ORDER prioriza socios más recientes; los perfiles sin fecha caen al
  // final para que no "ensucien" la parte alta de la tabla en la consola.
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${TABLE}
     ORDER BY member_since DESC NULLS LAST, created_at DESC`,
  )
  return rows
}

export async function upsertProfile(client, { userId, appId, tenantId, subTenantId, fields }) {
  // INSERT … ON CONFLICT keeps the contract simple for the route handler:
  // PATCH /me always works, even before there's a row. Caller passes only
  // the fields it wants to change; SQL COALESCEs the rest from the
  // existing row (or NULL on first insert).
  const { rows } = await client.query(
    `INSERT INTO ${TABLE}
       (user_id, app_id, tenant_id, sub_tenant_id,
        member_number, member_since, aikido_grade, dojo_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id) DO UPDATE SET
       member_number = COALESCE($5, ${TABLE}.member_number),
       member_since  = COALESCE($6, ${TABLE}.member_since),
       aikido_grade  = COALESCE($7, ${TABLE}.aikido_grade),
       dojo_name     = COALESCE($8, ${TABLE}.dojo_name),
       notes         = COALESCE($9, ${TABLE}.notes),
       updated_at    = now()
     RETURNING ${COLUMNS}`,
    [
      userId, appId, tenantId, subTenantId ?? null,
      fields.memberNumber ?? null,
      fields.memberSince  ?? null,
      fields.aikidoGrade  ?? null,
      fields.dojoName     ?? null,
      fields.notes        ?? null,
    ],
  )
  return rows[0]
}

export async function deleteByUserId(client, userId) {
  const { rowCount } = await client.query(
    `DELETE FROM ${TABLE} WHERE user_id = $1`,
    [userId],
  )
  return rowCount > 0
}
