// Repository de app_aikikan.certificates. RLS scopea por (app_id, tenant_id);
// las queries asumen que ya estamos dentro de withTenantTransaction.

const TABLE = 'app_aikikan.certificates'
const COLS  = `id, app_id, tenant_id, sub_tenant_id, user_id, issued_by_user_id,
               kind, title, grade_value, event_id, file_object_id,
               issued_at, notes, revoked_at, created_at, updated_at`

// Certificados activos (no revocados) del socio actual, recientes primero.
export async function findActiveByUser(client, userId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE}
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY issued_at DESC, created_at DESC`,
    [userId],
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE} WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function insert(client, {
  appId, tenantId, subTenantId, userId, issuedByUserId,
  kind, title, gradeValue, eventId, fileObjectId, issuedAt, notes,
}) {
  const { rows } = await client.query(
    `INSERT INTO ${TABLE}
       (app_id, tenant_id, sub_tenant_id, user_id, issued_by_user_id,
        kind, title, grade_value, event_id, file_object_id, issued_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::date, CURRENT_DATE), $12)
     RETURNING ${COLS}`,
    [appId, tenantId, subTenantId ?? null, userId, issuedByUserId,
     kind, title, gradeValue ?? null, eventId ?? null,
     fileObjectId, issuedAt ?? null, notes ?? null],
  )
  return rows[0]
}

// Revocar = soft-delete. La fila se queda en BD pero deja de listarse
// en findActiveByUser; útil para auditar y por si hace falta restaurar.
export async function revoke(client, id) {
  const { rows } = await client.query(
    `UPDATE ${TABLE} SET revoked_at = now(), updated_at = now()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING ${COLS}`,
    [id],
  )
  return rows[0] ?? null
}
