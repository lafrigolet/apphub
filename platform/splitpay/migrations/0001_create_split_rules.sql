-- Migration 0001: create split_rules table
-- Stores named, reusable split configurations per tenant

SET search_path TO splitpay_core;

CREATE TABLE IF NOT EXISTS split_rules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL,
  sub_tenant_id        UUID,
  name                 TEXT        NOT NULL,
  platform_fee_percent NUMERIC(5,2) NOT NULL CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),
  recipients           JSONB       NOT NULL DEFAULT '[]',
  active               BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_split_rules_tenant ON split_rules (tenant_id) WHERE active = true;
CREATE INDEX idx_split_rules_tenant_sub ON split_rules (tenant_id, sub_tenant_id) WHERE sub_tenant_id IS NOT NULL;

-- Row Level Security
ALTER TABLE split_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY split_rules_tenant_isolation ON split_rules
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION payments.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER split_rules_updated_at
  BEFORE UPDATE ON split_rules
  FOR EACH ROW EXECUTE FUNCTION payments.update_updated_at();
