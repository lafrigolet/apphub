const APP_COLUMNS = `
  id, app_id, display_name, subdomain, jwt_audience, status, splitpay_enabled, created_at
`

export async function findAll(client) {
  const { rows } = await client.query(
    `SELECT ${APP_COLUMNS} FROM platform_tenants.apps ORDER BY created_at`,
  )
  return rows
}

export async function findByAppId(client, appId) {
  const { rows } = await client.query(
    `SELECT ${APP_COLUMNS} FROM platform_tenants.apps WHERE app_id = $1`,
    [appId],
  )
  return rows[0] ?? null
}

export async function create(client, { appId, displayName, subdomain, jwtAudience, splitpayEnabled = false }) {
  const { rows } = await client.query(
    `INSERT INTO platform_tenants.apps (app_id, display_name, subdomain, jwt_audience, splitpay_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${APP_COLUMNS}`,
    [appId, displayName, subdomain, jwtAudience, splitpayEnabled],
  )
  return rows[0]
}

export async function updateStatus(client, appId, status) {
  const { rows } = await client.query(
    `UPDATE platform_tenants.apps SET status = $2 WHERE app_id = $1
     RETURNING ${APP_COLUMNS}`,
    [appId, status],
  )
  return rows[0] ?? null
}

export async function updateSplitpayEnabled(client, appId, enabled) {
  const { rows } = await client.query(
    `UPDATE platform_tenants.apps SET splitpay_enabled = $2 WHERE app_id = $1
     RETURNING ${APP_COLUMNS}`,
    [appId, enabled],
  )
  return rows[0] ?? null
}
