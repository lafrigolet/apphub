const SCHEMA = 'platform_donations'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, cause_id,
  donor_user_id, donor_email, donor_name, donor_nif,
  amount_cents, currency, status,
  stripe_subscription_id, stripe_customer_id,
  current_period_end, cancel_at_period_end, cancelled_at,
  created_at, updated_at
`

export async function upsertByStripeId(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.donation_subscriptions
       (app_id, tenant_id, sub_tenant_id, cause_id,
        donor_user_id, donor_email, donor_name, donor_nif,
        amount_cents, currency, status,
        stripe_subscription_id, stripe_customer_id,
        current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, FALSE))
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       status               = EXCLUDED.status,
       current_period_end   = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at           = now()
     RETURNING ${COLUMNS}`,
    [
      s.appId, s.tenantId, s.subTenantId ?? null, s.causeId ?? null,
      s.donorUserId ?? null, s.donorEmail, s.donorName ?? null, s.donorNif ?? null,
      s.amountCents, s.currency ?? 'EUR', s.status,
      s.stripeSubscriptionId, s.stripeCustomerId,
      s.currentPeriodEnd ?? null, s.cancelAtPeriodEnd ?? false,
    ],
  )
  return rows[0]
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donation_subscriptions WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function findByStripeId(client, stripeSubscriptionId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donation_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
    [stripeSubscriptionId],
  )
  return rows[0] ?? null
}

export async function listForDonor(client, donorUserId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.donation_subscriptions
      WHERE donor_user_id = $1
      ORDER BY created_at DESC`,
    [donorUserId],
  )
  return rows
}

export async function markCancelled(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.donation_subscriptions
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id],
  )
  return rows[0] ?? null
}
