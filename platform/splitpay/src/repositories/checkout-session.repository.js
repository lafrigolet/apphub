// Repository para splitpay_core.checkout_sessions. Las queries asumen
// que el caller ya estableció el RLS context (set_config app.tenant_id)
// vía withTenant().

const COLS = `id, tenant_id, sub_tenant_id, app_id, mode, stripe_session_id,
              stripe_payment_intent_id, stripe_subscription_id, stripe_customer_id,
              amount, currency, status, split_rule_id, metadata, idempotency_key,
              created_at, completed_at`

export async function insert(client, ctx, s) {
  const { rows } = await client.query(
    `INSERT INTO splitpay_core.checkout_sessions
       (tenant_id, sub_tenant_id, app_id, mode, stripe_session_id, currency, status, split_rule_id, metadata, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9)
     RETURNING ${COLS}`,
    [
      ctx.tenantId, ctx.subTenantId ?? null, ctx.appId ?? null,
      s.mode, s.stripeSessionId, s.currency, s.splitRuleId ?? null, s.metadata ?? {},
      s.idempotencyKey ?? null,
    ],
  )
  return rows[0]
}

// Tenant-scoped idempotency lookup (priority #8). Returns a prior session row
// created with the same (tenant_id, idempotency_key) so a retried POST replays
// the existing Stripe session instead of opening a second one.
export async function findByTenantIdempotencyKey(client, ctx, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM splitpay_core.checkout_sessions
      WHERE tenant_id = $1 AND idempotency_key = $2`,
    [ctx.tenantId, idempotencyKey],
  )
  return rows[0] ?? null
}

export async function findByStripeSessionId(client, stripeSessionId) {
  // Sin filtro de tenant — el webhook viene con el sessionId solo y
  // necesita encontrar el row para deducir tenant. RLS bypassed: este
  // lookup corre con el role del platform-core que tiene visibility.
  const { rows } = await client.query(
    `SELECT ${COLS} FROM splitpay_core.checkout_sessions WHERE stripe_session_id = $1`,
    [stripeSessionId],
  )
  return rows[0] ?? null
}

export async function markCompleted(client, stripeSessionId, fields) {
  const { rows } = await client.query(
    `UPDATE splitpay_core.checkout_sessions
        SET status = 'completed', completed_at = now(),
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
            stripe_subscription_id   = COALESCE($3, stripe_subscription_id),
            stripe_customer_id       = COALESCE($4, stripe_customer_id),
            amount                   = COALESCE($5, amount)
      WHERE stripe_session_id = $1
      RETURNING ${COLS}`,
    [
      stripeSessionId,
      fields.paymentIntentId ?? null,
      fields.subscriptionId  ?? null,
      fields.customerId      ?? null,
      fields.amount          ?? null,
    ],
  )
  return rows[0] ?? null
}

export async function listForTenant(client, ctx, limit = 50) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM splitpay_core.checkout_sessions
      WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [ctx.tenantId, limit],
  )
  return rows
}
