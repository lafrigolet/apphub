const SCHEMA = 'platform_chat'

const COLS = `
  app_id, tenant_id, allow_groups, max_group_size, redaction_enabled,
  retention_days, support_enabled, created_at, updated_at
`

export async function find(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.settings WHERE app_id = $1 AND tenant_id = $2`,
    [appId, tenantId],
  )
  return rows[0] ?? null
}

export async function upsert(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.settings
       (app_id, tenant_id, allow_groups, max_group_size, redaction_enabled, retention_days, support_enabled)
     VALUES ($1,$2,
       COALESCE($3, true), COALESCE($4, 256), COALESCE($5, false), $6, COALESCE($7, true))
     ON CONFLICT (app_id, tenant_id) DO UPDATE SET
       allow_groups      = COALESCE($3, ${SCHEMA}.settings.allow_groups),
       max_group_size    = COALESCE($4, ${SCHEMA}.settings.max_group_size),
       redaction_enabled = COALESCE($5, ${SCHEMA}.settings.redaction_enabled),
       retention_days    = $6,
       support_enabled   = COALESCE($7, ${SCHEMA}.settings.support_enabled)
     RETURNING ${COLS}`,
    [
      appId, tenantId,
      s.allowGroups ?? null, s.maxGroupSize ?? null, s.redactionEnabled ?? null,
      s.retentionDays ?? null, s.supportEnabled ?? null,
    ],
  )
  return rows[0]
}
