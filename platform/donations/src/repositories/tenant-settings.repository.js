// Configuración por tenant del módulo donations. V2: sólo importes
// sugeridos por defecto (rec. #6). Una fila por (app_id, tenant_id,
// sub_tenant_id). RLS por (app_id, tenant_id) idéntica al resto.

const SCHEMA = 'platform_donations'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id,
  default_suggested_amounts_cents, created_at, updated_at
`

export async function find(client, { appId, tenantId, subTenantId = null }) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.tenant_settings
      WHERE app_id = $1 AND tenant_id = $2
        AND sub_tenant_id IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [appId, tenantId, subTenantId],
  )
  return rows[0] ?? null
}

// Upsert de la configuración. Crea la fila si no existe; si existe,
// actualiza los importes sugeridos por defecto.
export async function upsert(client, { appId, tenantId, subTenantId = null, defaultSuggestedAmountsCents }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.tenant_settings
       (app_id, tenant_id, sub_tenant_id, default_suggested_amounts_cents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id, tenant_id, sub_tenant_id) DO UPDATE SET
       default_suggested_amounts_cents = EXCLUDED.default_suggested_amounts_cents,
       updated_at                      = now()
     RETURNING ${COLUMNS}`,
    [appId, tenantId, subTenantId, defaultSuggestedAmountsCents ?? []],
  )
  return rows[0]
}
