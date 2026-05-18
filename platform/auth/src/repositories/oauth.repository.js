const SCHEMA = 'platform_auth'

export async function findConnectionByProvider(client, provider, providerUid) {
  const { rows } = await client.query(
    `SELECT oc.*, u.app_id, u.tenant_id, u.sub_tenant_id, u.email AS user_email, u.role
     FROM ${SCHEMA}.oauth_connections oc
     JOIN ${SCHEMA}.users u ON u.id = oc.user_id
     WHERE oc.provider = $1 AND oc.provider_uid = $2 LIMIT 1`,
    [provider, providerUid],
  )
  return rows[0] ?? null
}

export async function findByEmailForOAuth(client, appId, tenantId, email) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.users WHERE app_id = $1 AND tenant_id = $2 AND email = $3 LIMIT 1`,
    [appId, tenantId, email],
  )
  return rows[0] ?? null
}

export async function createUserWithOAuth(client, { id, appId, tenantId, subTenantId, email, role, provider, providerUid, name, avatarUrl, pendingApproval = false }) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.users (id, app_id, tenant_id, sub_tenant_id, email, role, display_name, pending_approval)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, appId, tenantId, subTenantId ?? null, email, role, name ?? null, pendingApproval],
  )
  const user = rows[0]
  await client.query(
    `INSERT INTO ${SCHEMA}.oauth_connections (user_id, provider, provider_uid, email, name, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, provider, providerUid, email, name ?? null, avatarUrl ?? null],
  )
  return user
}

export async function upsertConnection(client, { userId, provider, providerUid, email, name, avatarUrl }) {
  await client.query(
    `INSERT INTO ${SCHEMA}.oauth_connections (user_id, provider, provider_uid, email, name, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_uid) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url`,
    [userId, provider, providerUid, email, name ?? null, avatarUrl ?? null],
  )
}
