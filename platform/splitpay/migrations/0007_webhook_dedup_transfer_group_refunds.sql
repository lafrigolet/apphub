-- Migration 0007: webhook event deduplication + explicit transfer_group +
-- persisted refunds ledger.
--
-- Priorities from docs/use-cases/splitpay.md "Recomendaciones de priorización":
--   #1 transfer_group explícito — columna en transactions para trazar todos los
--      transfers de un mismo pago y arreglar el lookup de reversals.
--   #2 deduplicación de eventos webhook por event.id — Stripe puede entregar el
--      mismo evento >1 vez; sin dedup createAdditionalTransfers se ejecuta dos veces.
--   #7 tabla refunds — trazabilidad completa de quién/cuándo/por qué de cada
--      reembolso, ligada a la transacción.

SET search_path TO splitpay_core;

-- ── #2 Webhook event deduplication ──────────────────────────────────────────
-- Global table (Stripe event ids are globally unique; no tenant scoping needed).
-- INSERT ... ON CONFLICT DO NOTHING gives exactly-once processing semantics.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id     TEXT        PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── #1 transfer_group explícito ─────────────────────────────────────────────
-- Set on PaymentIntent.transfer_data + on every additional transfer so that
-- createRefund can list exactly the transfers that belong to this payment.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_group TEXT;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group
  ON transactions (transfer_group) WHERE transfer_group IS NOT NULL;

-- ── #7 refunds ledger ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refunds (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL,
  sub_tenant_id     UUID,
  transaction_id    UUID        NOT NULL REFERENCES transactions (id),
  stripe_refund_id  TEXT        NOT NULL UNIQUE,
  amount            INTEGER     NOT NULL CHECK (amount >= 0),
  currency          CHAR(3)     NOT NULL,
  reason            TEXT,
  reversals         JSONB       NOT NULL DEFAULT '[]',
  idempotency_key   TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refunds_tenant      ON refunds (tenant_id, created_at DESC);
CREATE INDEX idx_refunds_transaction ON refunds (transaction_id);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY refunds_tenant_isolation ON refunds
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER refunds_updated_at
  BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION payments.update_updated_at();
