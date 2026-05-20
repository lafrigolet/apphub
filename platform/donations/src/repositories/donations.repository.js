const SCHEMA = 'platform_donations'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, cause_id,
  donor_user_id, donor_email, donor_name, donor_nif,
  donor_address, donor_postal_code, donor_country,
  amount_cents, currency, status, kind, anonymous, message,
  stripe_session_id, stripe_payment_intent_id, subscription_id,
  paid_at, refunded_at, refund_reason, created_at, updated_at
`

export async function insert(client, d) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.donations
       (app_id, tenant_id, sub_tenant_id, cause_id,
        donor_user_id, donor_email, donor_name, donor_nif,
        donor_address, donor_postal_code, donor_country,
        amount_cents, currency, status, kind, anonymous, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING ${COLUMNS}`,
    [
      d.appId, d.tenantId, d.subTenantId ?? null, d.causeId ?? null,
      d.donorUserId ?? null, d.donorEmail, d.donorName ?? null, d.donorNif ?? null,
      d.donorAddress ?? null, d.donorPostalCode ?? null, d.donorCountry ?? null,
      d.amountCents, d.currency ?? 'EUR', d.status ?? 'pending', d.kind,
      d.anonymous ?? false, d.message ?? null,
    ],
  )
  return rows[0]
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donations WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function findBySessionId(client, sessionId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donations WHERE stripe_session_id = $1 LIMIT 1`, [sessionId],
  )
  return rows[0] ?? null
}

export async function attachSession(client, id, sessionId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.donations SET stripe_session_id = $2, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, sessionId],
  )
  return rows[0] ?? null
}

export async function markPaid(client, id, { paymentIntentId, paidAt }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.donations
       SET status                   = 'paid',
           stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
           paid_at                  = COALESCE($3, now()),
           updated_at               = now()
     WHERE id = $1 AND status IN ('pending','failed')
     RETURNING ${COLUMNS}`,
    [id, paymentIntentId ?? null, paidAt ?? null],
  )
  return rows[0] ?? null
}

export async function markRefunded(client, id, reason) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.donations
       SET status         = 'refunded',
           refunded_at    = now(),
           refund_reason  = $2,
           updated_at     = now()
     WHERE id = $1 AND status = 'paid'
     RETURNING ${COLUMNS}`,
    [id, reason ?? null],
  )
  return rows[0] ?? null
}

export async function listForDonor(client, donorUserId, { limit = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donations
      WHERE donor_user_id = $1
      ORDER BY paid_at DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [donorUserId, limit],
  )
  return rows
}

export async function listAdmin(client, { causeId, status, fromDate, toDate, limit = 200, offset = 0 } = {}) {
  const conds = []
  const params = []
  if (causeId)  { params.push(causeId);  conds.push(`cause_id = $${params.length}`) }
  if (status)   { params.push(status);   conds.push(`status = $${params.length}`) }
  if (fromDate) { params.push(fromDate); conds.push(`paid_at >= $${params.length}`) }
  if (toDate)   { params.push(toDate);   conds.push(`paid_at <= $${params.length}`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donations
       ${where}
       ORDER BY paid_at DESC NULLS LAST, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// Listado para certificado fiscal: agrupa por donor_nif para un año.
export async function listByNifAndYear(client, year) {
  const { rows } = await client.query(
    `SELECT id, donor_nif, donor_email, donor_name,
            donor_address, donor_postal_code, donor_country,
            amount_cents, paid_at, cause_id
       FROM ${SCHEMA}.donations
      WHERE donor_nif IS NOT NULL
        AND status = 'paid'
        AND EXTRACT(YEAR FROM paid_at) = $1
      ORDER BY donor_nif, paid_at`,
    [year],
  )
  return rows
}
