-- Stripe Checkout Sessions managed by splitpay.
--
-- Distinct from `transactions` (which tracks PaymentIntents created
-- directly with split rules). A Checkout Session can resolve to either
-- a PaymentIntent (mode=payment) or a Subscription (mode=subscription),
-- and may or may not carry a split rule. When `split_rule_id` IS NULL,
-- the destination is implicit: the platform's own Stripe account (no
-- transfers, no application fee) — what we call "no-split" mode.

SET search_path TO splitpay_core;

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  sub_tenant_id            UUID,
  app_id                   TEXT,                         -- el app del caller (aikikan, …)

  mode                     TEXT NOT NULL CHECK (mode IN ('payment', 'subscription')),
  stripe_session_id        TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,                          -- mode=payment
  stripe_subscription_id   TEXT,                          -- mode=subscription
  stripe_customer_id       TEXT,
  amount                   INTEGER,                       -- conocido al completar
  currency                 CHAR(3) NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open',  -- open|completed|expired
  split_rule_id            UUID REFERENCES split_rules(id),
  metadata                 JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_tenant ON checkout_sessions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_stripe ON checkout_sessions (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON checkout_sessions (tenant_id, status);

ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;

-- RLS por (tenant_id) — splitpay no usa app_id en su contexto pero
-- aceptamos JWTs de cualquier app, así que filtrar solo por tenant es
-- suficiente.
CREATE POLICY checkout_sessions_isolation ON checkout_sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
