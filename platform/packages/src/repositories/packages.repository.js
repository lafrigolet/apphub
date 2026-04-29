const SCHEMA = 'platform_packages'

export async function insertTemplate(client, appId, tenantId, t) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.package_templates
       (app_id, tenant_id, code, name, description, service_id,
        total_sessions, validity_days, price_cents, currency, is_active, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,365),COALESCE($9,0),COALESCE($10,'EUR'),COALESCE($11,TRUE),COALESCE($12,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, t.code, t.name, t.description ?? null, t.serviceId,
     t.totalSessions, t.validityDays ?? 365, t.priceCents ?? 0,
     t.currency ?? 'EUR', t.isActive ?? true, t.metadata ?? {}],
  )
  return rows[0]
}

export async function findTemplateById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.package_templates WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listTemplates(client, appId, tenantId, { onlyActive = true } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (onlyActive) filters.push('is_active = TRUE')
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.package_templates WHERE ${filters.join(' AND ')} ORDER BY name`,
    params,
  )
  return rows
}

export async function insertPurchase(client, appId, tenantId, p) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.purchased_packages
       (app_id, tenant_id, template_id, client_user_id, service_id,
        total_sessions, remaining_sessions, price_paid_cents, currency, status, expires_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0),COALESCE($9,'EUR'),COALESCE($10,'active'),$11,COALESCE($12,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, p.templateId, p.clientUserId, p.serviceId,
     p.totalSessions, p.remainingSessions, p.pricePaidCents ?? 0,
     p.currency ?? 'EUR', p.status ?? 'active', p.expiresAt, p.metadata ?? {}],
  )
  return rows[0]
}

export async function findPurchaseById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.purchased_packages WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listPurchasesForClient(client, appId, tenantId, clientUserId, { onlyActive = true } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2', 'client_user_id = $3']
  const params  = [appId, tenantId, clientUserId]
  if (onlyActive) filters.push("status = 'active' AND expires_at > now() AND remaining_sessions > 0")
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.purchased_packages WHERE ${filters.join(' AND ')} ORDER BY purchased_at DESC`,
    params,
  )
  return rows
}

export async function findActivePackageFor(client, appId, tenantId, clientUserId, serviceId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.purchased_packages
     WHERE app_id=$1 AND tenant_id=$2 AND client_user_id=$3 AND service_id=$4
       AND status='active' AND expires_at > now() AND remaining_sessions > 0
     ORDER BY expires_at ASC
     LIMIT 1`,
    [appId, tenantId, clientUserId, serviceId],
  )
  return rows[0] ?? null
}

export async function decrementSessions(client, appId, tenantId, packageId, delta) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.purchased_packages
     SET remaining_sessions = remaining_sessions + $4,
         status = CASE
                    WHEN remaining_sessions + $4 <= 0 THEN 'exhausted'
                    ELSE status
                  END
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3
       AND remaining_sessions + $4 >= 0
     RETURNING *`,
    [appId, tenantId, packageId, delta],
  )
  return rows[0] ?? null
}

export async function setStatus(client, appId, tenantId, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.purchased_packages SET status=$4
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

export async function insertRedemption(client, appId, tenantId, r) {
  await client.query(
    `INSERT INTO ${SCHEMA}.redemptions (app_id, tenant_id, package_id, booking_id, delta, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [appId, tenantId, r.packageId, r.bookingId ?? null, r.delta, r.reason],
  )
}

export async function listRedemptions(client, appId, tenantId, packageId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.redemptions
     WHERE app_id=$1 AND tenant_id=$2 AND package_id=$3 ORDER BY created_at`,
    [appId, tenantId, packageId],
  )
  return rows
}
