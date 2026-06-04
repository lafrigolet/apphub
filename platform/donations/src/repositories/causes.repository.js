const SCHEMA = 'platform_donations'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, code, name, description,
  target_cents, raised_cents, currency, image_object_id,
  suggested_amounts_cents,
  active, position, starts_at, ends_at, created_at, updated_at
`

export async function list(client, { onlyActive = true } = {}) {
  const where = onlyActive ? `WHERE active = TRUE` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.causes ${where} ORDER BY position, created_at`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.causes WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function findByCode(client, appId, tenantId, code) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.causes
     WHERE app_id = $1 AND tenant_id = $2 AND code = $3 LIMIT 1`,
    [appId, tenantId, code],
  )
  return rows[0] ?? null
}

export async function insert(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.causes
       (app_id, tenant_id, sub_tenant_id, code, name, description,
        target_cents, currency, image_object_id, active, position, starts_at, ends_at,
        suggested_amounts_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, TRUE), COALESCE($11, 0), $12, $13, $14)
     RETURNING ${COLUMNS}`,
    [
      c.appId, c.tenantId, c.subTenantId ?? null, c.code, c.name, c.description ?? null,
      c.targetCents ?? null, c.currency ?? 'EUR', c.imageObjectId ?? null,
      c.active, c.position, c.startsAt ?? null, c.endsAt ?? null,
      c.suggestedAmountsCents ?? null,
    ],
  )
  return rows[0]
}

export async function update(client, id, patch) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.causes SET
       name                    = COALESCE($2, name),
       description             = COALESCE($3, description),
       target_cents            = COALESCE($4, target_cents),
       image_object_id         = COALESCE($5, image_object_id),
       active                  = COALESCE($6, active),
       position                = COALESCE($7, position),
       starts_at               = COALESCE($8, starts_at),
       ends_at                 = COALESCE($9, ends_at),
       suggested_amounts_cents = COALESCE($10, suggested_amounts_cents),
       updated_at              = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id, patch.name ?? null, patch.description ?? null, patch.targetCents ?? null,
      patch.imageObjectId ?? null, patch.active ?? null, patch.position ?? null,
      patch.startsAt ?? null, patch.endsAt ?? null,
      patch.suggestedAmountsCents ?? null,
    ],
  )
  return rows[0] ?? null
}

export async function softDelete(client, id) {
  const { rowCount } = await client.query(
    `UPDATE ${SCHEMA}.causes SET active = FALSE, updated_at = now() WHERE id = $1`, [id],
  )
  return rowCount > 0
}

export async function incrementRaised(client, id, deltaCents) {
  await client.query(
    `UPDATE ${SCHEMA}.causes SET raised_cents = raised_cents + $2, updated_at = now() WHERE id = $1`,
    [id, deltaCents],
  )
}
