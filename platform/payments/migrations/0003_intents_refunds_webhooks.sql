-- Transactional engine for the payments module: one-shot PaymentIntents,
-- refunds and webhook-event deduplication. Builds on the pre-existing
-- platform_payments.transactions table (created in 0001).

-- 0001 created `transactions` without a per-tenant idempotency column nor the
-- columns the PaymentIntent lifecycle needs. Add them here (non-destructive).
ALTER TABLE platform_payments.transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS last_error      TEXT;

-- Idempotency key is unique per (app_id, tenant_id): the same caller key can
-- never produce two charges, but different tenants may reuse the same key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_payments_idem
  ON platform_payments.transactions (app_id, tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Refunds ────────────────────────────────────────────────────────────────
-- Total / partial refunds against a transaction. Cumulative partials must not
-- exceed the original amount (enforced in the service layer, scoped by tenant).
CREATE TABLE IF NOT EXISTS platform_payments.refunds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT NOT NULL,
  tenant_id         UUID NOT NULL,
  sub_tenant_id     UUID,
  transaction_id    UUID NOT NULL REFERENCES platform_payments.transactions (id),
  provider_refund_id TEXT UNIQUE,
  amount_cents      INT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'eur',
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  idempotency_key   TEXT,
  created_by_user_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_refunds_tx
  ON platform_payments.refunds (transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_payments_refunds_idem
  ON platform_payments.refunds (app_id, tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
ALTER TABLE platform_payments.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payments.refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payments_refunds_isolation ON platform_payments.refunds
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Webhook events ───────────────────────────────────────────────────────────
-- Dedup store: every Stripe event id is recorded once. Replays (Stripe retries)
-- are dropped. This table is global (not tenant-scoped) because webhooks arrive
-- before we know the tenant; the handler resolves the tenant from the object.
CREATE TABLE IF NOT EXISTS platform_payments.webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'received',
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_webhook_events_type
  ON platform_payments.webhook_events (type);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_payments.refunds        TO svc_platform_payments;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_payments.webhook_events TO svc_platform_payments;
