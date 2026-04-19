-- Migration 0004: create disputes table
-- Tracks Stripe chargebacks and their evidence submission state

SET search_path TO payments;

CREATE TABLE IF NOT EXISTS disputes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id TEXT        NOT NULL UNIQUE,
  stripe_charge_id  TEXT        NOT NULL,
  amount            INTEGER     NOT NULL,
  currency          CHAR(3)     NOT NULL,
  reason            TEXT,
  status            TEXT        NOT NULL,
  due_by            TIMESTAMPTZ,
  evidence_sent     BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disputes_charge ON disputes (stripe_charge_id);
CREATE INDEX idx_disputes_status ON disputes (status) WHERE status = 'needs_response';

CREATE TRIGGER disputes_updated_at
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION payments.update_updated_at();
