export async function findAll(client) {
  const { rows } = await client.query(
    `SELECT id, app_id, display_name, subdomain, jwt_audience, status, created_at
     FROM platform_tenants.apps ORDER BY created_at`,
  )
  return rows
}

export async function findByAppId(client, appId) {
  const { rows } = await client.query(
    `SELECT id, app_id, display_name, subdomain, jwt_audience, status, created_at
     FROM platform_tenants.apps WHERE app_id = $1`,
    [appId],
  )
  return rows[0] ?? null
}

export async function create(client, { appId, displayName, subdomain, jwtAudience }) {
  const { rows } = await client.query(
    `INSERT INTO platform_tenants.apps (app_id, display_name, subdomain, jwt_audience)
     VALUES ($1, $2, $3, $4)
     RETURNING id, app_id, display_name, subdomain, jwt_audience, status, created_at`,
    [appId, displayName, subdomain, jwtAudience],
  )
  return rows[0]
}

export async function updateStatus(client, appId, status) {
  const { rows } = await client.query(
    `UPDATE platform_tenants.apps SET status = $2 WHERE app_id = $1
     RETURNING id, app_id, display_name, subdomain, jwt_audience, status, created_at`,
    [appId, status],
  )
  return rows[0] ?? null
}
