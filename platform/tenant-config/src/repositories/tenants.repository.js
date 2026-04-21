export async function findAll(client, appId) {
  const query = appId
    ? `SELECT id, app_id, display_name, subdomain, status, created_at
       FROM platform_tenants.tenants WHERE app_id = $1 ORDER BY created_at`
    : `SELECT id, app_id, display_name, subdomain, status, created_at
       FROM platform_tenants.tenants ORDER BY created_at`
  const { rows } = await client.query(query, appId ? [appId] : [])
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT id, app_id, display_name, subdomain, status, created_at
     FROM platform_tenants.tenants WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function create(client, { appId, displayName, subdomain }) {
  const { rows } = await client.query(
    `INSERT INTO platform_tenants.tenants (app_id, display_name, subdomain)
     VALUES ($1, $2, $3)
     RETURNING id, app_id, display_name, subdomain, status, created_at`,
    [appId, displayName, subdomain],
  )
  return rows[0]
}

export async function updateStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE platform_tenants.tenants SET status = $2 WHERE id = $1
     RETURNING id, app_id, display_name, subdomain, status, created_at`,
    [id, status],
  )
  return rows[0] ?? null
}
