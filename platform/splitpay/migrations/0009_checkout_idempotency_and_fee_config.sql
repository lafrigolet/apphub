-- Migration 0009: Checkout Session idempotency + configurable Stripe fee.
--
-- Priorities from docs/use-cases/splitpay.md "Recomendaciones de priorización":
--   #8 idempotencia de Checkout Sessions + namespacing de claves por
--      (tenant_id, key) — evita colisiones cross-tenant y sesiones duplicadas.
--   #9 tarifa de Stripe configurable por región — elimina el hardcode 2.9% + 30c
--      que falsea el cálculo de transfers adicionales en muchos países.

SET search_path TO splitpay_core;

-- ── #8 Checkout Session idempotency ─────────────────────────────────────────
-- Persisted idempotency: a unique (tenant_id, idempotency_key) lets a retried
-- POST /checkout-sessions return the SAME session row instead of creating a
-- second Stripe session. tenant-scoped uniqueness avoids cross-tenant key
-- collisions (the Redis-based idempotency in payments has the same intent but
-- the namespacing fix lives in lib/redis.js scoped helpers).
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_sessions_tenant_idem
  ON checkout_sessions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── #9 Configurable Stripe fee (per platform / region) ──────────────────────
-- The 2.9% + 30c fee was hardcoded in utils/split-engine.js. Make it a runtime
-- config so the additional-transfer net-amount math reflects the real rate.
-- Both are non-secret plain values. The inline CHECK on config.key (migration
-- 0005) is anonymous; recreate it to admit the two new keys.
ALTER TABLE config DROP CONSTRAINT IF EXISTS config_key_check;
ALTER TABLE config ADD CONSTRAINT config_key_check CHECK (
  key IN (
    'platform_account_id',
    'stripe_secret_key',
    'stripe_publishable_key',
    'stripe_webhook_secret',
    'stripe_fee_percent',
    'stripe_fee_fixed'
  )
);
