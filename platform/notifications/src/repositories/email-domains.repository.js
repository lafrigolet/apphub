// Per-tenant verified sender domains. All queries run inside withTenantTransaction
// (see services/email-domains.service.js) so the RLS policy on
// platform_notifications.tenant_email_domains scopes them to (app_id, tenant_id).

export async function insert(client, { appId, tenantId, domain, provider, providerDomainId, dnsRecords }) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.tenant_email_domains
       (app_id, tenant_id, domain, provider, provider_domain_id, dns_records, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [appId, tenantId, domain, provider, providerDomainId, JSON.stringify(dnsRecords ?? [])],
  )
  return rows[0]
}

export async function listForTenant(client) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.tenant_email_domains ORDER BY created_at DESC`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.tenant_email_domains WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function findVerifiedByDomain(client, domain) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.tenant_email_domains
      WHERE domain = $1 AND status = 'verified'`,
    [domain],
  )
  return rows[0] ?? null
}

export async function setStatus(client, id, status, dnsRecords) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.tenant_email_domains
        SET status          = $2,
            dns_records     = COALESCE($3::jsonb, dns_records),
            last_checked_at = now(),
            verified_at     = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END,
            updated_at      = now()
      WHERE id = $1
      RETURNING *`,
    [id, status, dnsRecords != null ? JSON.stringify(dnsRecords) : null],
  )
  return rows[0] ?? null
}

export async function updateDefaults(client, id, { defaultFromLocal, defaultFromName, replyToAddress }) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.tenant_email_domains
        SET default_from_local = COALESCE($2, default_from_local),
            default_from_name  = COALESCE($3, default_from_name),
            reply_to_address   = COALESCE($4, reply_to_address),
            updated_at         = now()
      WHERE id = $1
      RETURNING *`,
    [id, defaultFromLocal ?? null, defaultFromName ?? null, replyToAddress ?? null],
  )
  return rows[0] ?? null
}

export async function suspend(client, id, reason) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.tenant_email_domains
        SET status         = 'suspended',
            suspended_at   = now(),
            suspend_reason = $2,
            updated_at     = now()
      WHERE id = $1
      RETURNING *`,
    [id, reason ?? null],
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  await client.query(
    `DELETE FROM platform_notifications.tenant_email_domains WHERE id = $1`,
    [id],
  )
}
