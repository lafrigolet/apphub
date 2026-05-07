// Repos para los tres recursos de Cuotas. Llaman dentro de
// withTenantTransaction (RLS context ya seteado).

const PROD_COLS    = `id, app_id, tenant_id, sub_tenant_id, code, name, description, amount_cents, currency, kind, interval_months, stripe_price_id, active, position, created_at, updated_at`
const PAY_COLS     = `id, app_id, tenant_id, sub_tenant_id, user_id, product_codes, amount_cents, currency, status, stripe_session_id, stripe_payment_intent, stripe_invoice_id, paid_at, created_at`
const SUB_COLS     = `id, app_id, tenant_id, sub_tenant_id, user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end, cancel_at_period_end, created_at, updated_at`

// ── Products ─────────────────────────────────────────────────────────
export async function listProducts(client) {
  const { rows } = await client.query(
    `SELECT ${PROD_COLS} FROM app_aikikan.fee_products
       WHERE active = TRUE ORDER BY position ASC`,
  )
  return rows
}

export async function findProductByCode(client, code) {
  const { rows } = await client.query(
    `SELECT ${PROD_COLS} FROM app_aikikan.fee_products WHERE code = $1`,
    [code],
  )
  return rows[0] ?? null
}

export async function findProductsByCodes(client, codes) {
  const { rows } = await client.query(
    `SELECT ${PROD_COLS} FROM app_aikikan.fee_products WHERE code = ANY($1)`,
    [codes],
  )
  return rows
}

// ── Payments ─────────────────────────────────────────────────────────
export async function insertPayment(client, p) {
  const { rows } = await client.query(
    `INSERT INTO app_aikikan.fee_payments
       (app_id, tenant_id, sub_tenant_id, user_id, product_codes, amount_cents, currency, status, stripe_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
     RETURNING ${PAY_COLS}`,
    [p.appId, p.tenantId, p.subTenantId ?? null, p.userId, p.productCodes, p.amountCents, p.currency, p.stripeSessionId ?? null],
  )
  return rows[0]
}

export async function listPaymentsForUser(client, userId, limit = 20) {
  const { rows } = await client.query(
    `SELECT ${PAY_COLS} FROM app_aikikan.fee_payments
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  )
  return rows
}

export async function markPaymentPaid(client, sessionId, paymentIntentId, invoiceId) {
  const { rows } = await client.query(
    `UPDATE app_aikikan.fee_payments
        SET status = 'paid', paid_at = now(),
            stripe_payment_intent = COALESCE($2, stripe_payment_intent),
            stripe_invoice_id     = COALESCE($3, stripe_invoice_id)
      WHERE stripe_session_id = $1 AND status = 'pending'
      RETURNING ${PAY_COLS}`,
    [sessionId, paymentIntentId ?? null, invoiceId ?? null],
  )
  return rows[0] ?? null
}

// Stripe envía invoice.paid también para renovaciones automáticas de la
// subscription — sin sesión de checkout. En esos casos creamos un row
// directamente como 'paid'.
export async function insertSubscriptionPayment(client, p) {
  const { rows } = await client.query(
    `INSERT INTO app_aikikan.fee_payments
       (app_id, tenant_id, sub_tenant_id, user_id, product_codes, amount_cents, currency, status, stripe_invoice_id, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8, now())
     ON CONFLICT DO NOTHING
     RETURNING ${PAY_COLS}`,
    [p.appId, p.tenantId, p.subTenantId ?? null, p.userId, p.productCodes, p.amountCents, p.currency, p.stripeInvoiceId],
  )
  return rows[0] ?? null
}

// ── Subscriptions ────────────────────────────────────────────────────
export async function findSubscriptionForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT ${SUB_COLS} FROM app_aikikan.fee_subscriptions WHERE user_id = $1`,
    [userId],
  )
  return rows[0] ?? null
}

export async function upsertSubscription(client, s) {
  const { rows } = await client.query(
    `INSERT INTO app_aikikan.fee_subscriptions
       (app_id, tenant_id, sub_tenant_id, user_id, status,
        stripe_subscription_id, stripe_customer_id,
        current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (app_id, tenant_id, user_id) DO UPDATE SET
       status                 = EXCLUDED.status,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_customer_id     = EXCLUDED.stripe_customer_id,
       current_period_end     = EXCLUDED.current_period_end,
       cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
       updated_at             = now()
     RETURNING ${SUB_COLS}`,
    [
      s.appId, s.tenantId, s.subTenantId ?? null, s.userId, s.status,
      s.stripeSubscriptionId, s.stripeCustomerId,
      s.currentPeriodEnd ?? null, s.cancelAtPeriodEnd ?? false,
    ],
  )
  return rows[0]
}

// Lookup por subscription_id de Stripe — el webhook recibe events que
// solo traen la subscription_id, así sabemos a quién pertenece.
export async function findSubscriptionByStripeId(client, stripeSubId) {
  const { rows } = await client.query(
    `SELECT ${SUB_COLS} FROM app_aikikan.fee_subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubId],
  )
  return rows[0] ?? null
}
