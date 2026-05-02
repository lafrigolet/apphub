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

// ── Authorised users (family / household sharing) ───────────────────────

export async function listAuthorizedUsers(client, appId, tenantId, packageId) {
  const { rows } = await client.query(
    `SELECT * FROM platform_packages.package_authorized_users
       WHERE app_id=$1 AND tenant_id=$2 AND package_id=$3
       ORDER BY created_at`,
    [appId, tenantId, packageId],
  )
  return rows
}

export async function addAuthorizedUser(client, appId, tenantId, packageId, { userId, displayName, addedBy }) {
  const { rows } = await client.query(
    `INSERT INTO platform_packages.package_authorized_users
       (app_id, tenant_id, package_id, user_id, display_name, added_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (package_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [appId, tenantId, packageId, userId, displayName ?? null, addedBy ?? null],
  )
  return rows[0]
}

export async function removeAuthorizedUser(client, appId, tenantId, packageId, userId) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_packages.package_authorized_users
       WHERE app_id=$1 AND tenant_id=$2 AND package_id=$3 AND user_id=$4`,
    [appId, tenantId, packageId, userId],
  )
  return rowCount > 0
}

export async function isAuthorized(client, appId, tenantId, packageId, userId) {
  const { rows } = await client.query(
    `SELECT 1 FROM platform_packages.package_authorized_users
       WHERE app_id=$1 AND tenant_id=$2 AND package_id=$3 AND user_id=$4 LIMIT 1`,
    [appId, tenantId, packageId, userId],
  )
  return rows.length > 0
}

// ── Transfer / gifting log + ownership change ───────────────────────────

export async function transferOwnership(client, appId, tenantId, packageId, fromUserId, toUserId, kind, message, actorUserId) {
  const { rows: pkgRows } = await client.query(
    `UPDATE platform_packages.purchased_packages
        SET client_user_id = $4
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 AND client_user_id=$5
      RETURNING *`,
    [appId, tenantId, packageId, toUserId, fromUserId],
  )
  if (!pkgRows[0]) return null
  const { rows: trRows } = await client.query(
    `INSERT INTO platform_packages.package_transfers
       (app_id, tenant_id, package_id, from_user_id, to_user_id, kind, message, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [appId, tenantId, packageId, fromUserId, toUserId, kind, message ?? null, actorUserId ?? null],
  )
  return { package: pkgRows[0], transfer: trRows[0] }
}

export async function listTransfers(client, appId, tenantId, packageId) {
  const { rows } = await client.query(
    `SELECT * FROM platform_packages.package_transfers
       WHERE app_id=$1 AND tenant_id=$2 AND package_id=$3
       ORDER BY created_at DESC`,
    [appId, tenantId, packageId],
  )
  return rows
}

// ── Auto-renew flag toggle ──────────────────────────────────────────────

export async function setAutoRenew(client, appId, tenantId, packageId, autoRenew) {
  const { rows } = await client.query(
    `UPDATE platform_packages.purchased_packages
        SET auto_renew = $4, updated_at = now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
      RETURNING *`,
    [appId, tenantId, packageId, !!autoRenew],
  )
  return rows[0] ?? null
}

// Build a fresh purchased_packages row cloned from `template` and link it
// back via renewed_from. Used by the renewal flow (manual today; cron later).
export async function insertRenewal(client, appId, tenantId, original, template) {
  const { rows } = await client.query(
    `INSERT INTO platform_packages.purchased_packages
       (app_id, tenant_id, template_id, client_user_id, service_id,
        total_sessions, remaining_sessions, price_paid_cents, currency,
        status, expires_at, auto_renew, renewed_from)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, 'active',
             now() + ($9 || ' days')::interval, $10, $11)
     RETURNING *`,
    [
      appId, tenantId, template.id, original.client_user_id, template.service_id,
      template.total_sessions, template.price_cents, template.currency,
      String(template.validity_days),
      original.auto_renew, original.id,
    ],
  )
  return rows[0]
}
