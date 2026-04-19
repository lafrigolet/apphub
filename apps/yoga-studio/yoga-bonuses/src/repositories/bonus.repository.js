export async function getActiveBonuses(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT b.*, bt.name AS type_name, bt.type AS bonus_type
     FROM yoga_bonuses.bonuses b
     JOIN yoga_bonuses.bonus_types bt ON bt.id = b.bonus_type_id
     WHERE b.user_id = $1 AND b.tenant_id = $2 AND b.is_active = true AND b.expires_at >= CURRENT_DATE
     ORDER BY b.expires_at ASC`,
    [userId, tenantId],
  )
  return rows
}

export async function checkAndDeductCredit(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT b.id, b.sessions_used, b.sessions_total, b.expires_at
     FROM yoga_bonuses.bonuses b
     WHERE b.user_id = $1 AND b.tenant_id = $2 AND b.is_active = true
       AND b.expires_at >= CURRENT_DATE
       AND (b.bonus_type_id IN (
             SELECT id FROM yoga_bonuses.bonus_types WHERE type = 'monthly_unlimited'
           )
           OR b.sessions_used < b.sessions_total)
     ORDER BY b.expires_at ASC
     LIMIT 1
     FOR UPDATE`,
    [userId, tenantId],
  )

  if (rows.length === 0) return null

  const bonus = rows[0]
  const { rows: updated } = await client.query(
    `UPDATE yoga_bonuses.bonuses
     SET sessions_used = sessions_used + 1
     WHERE id = $1
     RETURNING *`,
    [bonus.id],
  )

  await client.query(
    `INSERT INTO yoga_bonuses.credit_log (bonus_id, delta, reason, tenant_id, sub_tenant_id)
     VALUES ($1, -1, 'booking', (SELECT tenant_id FROM yoga_bonuses.bonuses WHERE id = $1), (SELECT sub_tenant_id FROM yoga_bonuses.bonuses WHERE id = $1))`,
    [bonus.id],
  )

  return updated[0]
}

export async function returnCredit(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT id, tenant_id, sub_tenant_id FROM yoga_bonuses.bonuses
     WHERE user_id = $1 AND tenant_id = $2 AND is_active = true AND expires_at >= CURRENT_DATE
     ORDER BY expires_at ASC LIMIT 1 FOR UPDATE`,
    [userId, tenantId],
  )
  if (rows.length === 0) return

  await client.query(
    `UPDATE yoga_bonuses.bonuses SET sessions_used = GREATEST(0, sessions_used - 1) WHERE id = $1`,
    [rows[0].id],
  )

  await client.query(
    `INSERT INTO yoga_bonuses.credit_log (bonus_id, delta, reason, tenant_id, sub_tenant_id)
     VALUES ($1, 1, 'cancellation_refund', $2, $3)`,
    [rows[0].id, rows[0].tenant_id, rows[0].sub_tenant_id],
  )
}

export async function activateBonusByPayment(client, { id, userId, bonusTypeId, tenantId, subTenantId }) {
  const { rows: types } = await client.query(
    'SELECT * FROM yoga_bonuses.bonus_types WHERE id = $1',
    [bonusTypeId],
  )
  if (!types.length) return null
  const bt = types[0]

  const startsAt = new Date()
  const expiresAt = new Date(startsAt)
  expiresAt.setDate(expiresAt.getDate() + bt.validity_days)

  const { rows } = await client.query(
    `INSERT INTO yoga_bonuses.bonuses
       (id, user_id, bonus_type_id, sessions_total, starts_at, expires_at, is_active, activated_by, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, true, 'payment', $7, $8)
     RETURNING *`,
    [id, userId, bonusTypeId, bt.sessions_count ?? 999, startsAt, expiresAt, tenantId, subTenantId ?? null],
  )
  return rows[0]
}

export async function createBonusType(client, { id, name, type, sessionsCount, validityDays, priceEur, tenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_bonuses.bonus_types (id, name, type, sessions_count, validity_days, price_eur, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, name, type, sessionsCount ?? null, validityDays, priceEur, tenantId],
  )
  return rows[0]
}

export async function assignBonus(client, { id, userId, bonusTypeId, tenantId, subTenantId }) {
  return activateBonusByPayment(client, { id, userId, bonusTypeId, tenantId, subTenantId })
}

export async function adjustCredits(client, { bonusId, delta, reason, tenantId, subTenantId }) {
  await client.query(
    `UPDATE yoga_bonuses.bonuses SET sessions_total = sessions_total + $2 WHERE id = $1`,
    [bonusId, delta],
  )
  await client.query(
    `INSERT INTO yoga_bonuses.credit_log (bonus_id, delta, reason, tenant_id, sub_tenant_id) VALUES ($1, $2, $3, $4, $5)`,
    [bonusId, delta, reason, tenantId, subTenantId ?? null],
  )
}

export async function findExpiringBonuses(client) {
  const { rows } = await client.query(
    `SELECT b.*, bt.name AS type_name
     FROM yoga_bonuses.bonuses b
     JOIN yoga_bonuses.bonus_types bt ON bt.id = b.bonus_type_id
     WHERE b.is_active = true
       AND (
         b.expires_at <= CURRENT_DATE + INTERVAL '7 days'
         OR (b.sessions_total - b.sessions_used) <= 2
       )`,
  )
  return rows
}
